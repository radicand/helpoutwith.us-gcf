import { fromEvent, FunctionEvent } from 'graphcool-lib';
import { GraphQLClient } from 'graphql-request';
import { getUser } from '../google/loggedInUser';
import { sendTemplate } from '../messaging/mailjet';

interface IUser {
  id: string;
  organizations: IOrganizationUserRole[];
}

interface IOrganizaton {
  name: string;
}

enum Role {
  Admin,
  Member,
}

interface IOrganizationUserRole {
  id: string;
  user: IUser;
  role: Role;
}

interface IEventData {
  organizationId: string;
  role: Role;
  email: string;
}

export default async (event: FunctionEvent<IEventData>) => {
  const graphcool = fromEvent(event);
  const api = graphcool.api('simple/v1');

  const { organizationId, role } = event.data;
  const email = event.data.email.toLocaleLowerCase();

  try {
    const isAdmin = event.context.auth && (await isOrgAdmin(api, organizationId, event.context.auth.nodeId));
    if (!isAdmin) {
      return { error: 'Current user is not authorized to add members to this organization' };
    }

    const currentUser = await getUser(api, event.context.auth.nodeId);

    let foundUser;
    const organization = await lookupOrgById(api, organizationId);
    let updateHappened = false;

    try {
      foundUser = await lookupUserByEmail(api, email, organizationId);
    } catch (ex) {
      foundUser = await inviteOrgUser(api, email, organizationId, role);
      updateHappened = true;
    }

    if (foundUser.organizations.length === 0) {
      foundUser = await addOrgUserRole(api, foundUser.id, organizationId, role);
      updateHappened = true;
    } else if (foundUser.organizations[0].role !== role) {
      foundUser = await updateOrgUserRole(api, foundUser, role, organizationId);
      updateHappened = true;
    }

    if (updateHappened) {
      try {
        sendTemplate({
          to: [ { email, name: email } ],
          cc: [ { email: currentUser.email, name: currentUser.email } ],
          templateId: 299339,
          variables: {
            to_email: email,
            created_by: currentUser.name, // who invited
            organization_name: organization.name,
            role_name: role.toString(),
          },
        });
      } catch (ex) {
        return { error: 'Unexpected error sending notification email to new user org link', detail: ex.message };
      }
    }

    return {
      data: {
        userId: foundUser.id,
        organizationId,
        role,
        organizationUserRoleId: foundUser.organizations[0].id,
      },
    };
  } catch (ex) {
    // console.log(ex.message);
    return { error: 'Unexpected error adding/updating user org link', detail: ex.message };
  }
};

async function isOrgAdmin(api: GraphQLClient, organizationId: string, userId: string): Promise<boolean> {
  const query = `
	query isOrgAdmin ($userId: ID!, $organizationId: ID!) {
		allOrganizationUserRoles(filter: {
			user: {
        id: $userId
      },
      organization: {
        id: $organizationId
      },
      role: Admin
		}) {
			id
		}
	}`;

  const data = {
    userId,
    organizationId,
  };

  return api.request<{ allOrganizationUserRoles: IOrganizationUserRole[] }>(query, data).then((r) => {
    return r.allOrganizationUserRoles.length === 1;
  });
}

async function lookupOrgById(api: GraphQLClient, organizationId: string): Promise<IOrganizaton> {
  const query = `
	query lookupOrgById ($organizationId: ID!) {
		Organization(id: $organizationId) {
			name
		}
	}`;

  const data = {
    organizationId,
  };

  return api.request<{ Organization }>(query, data).then((r) => r.Organization);
}

async function lookupUserByEmail(api: GraphQLClient, email: string, organizationId: string): Promise<IUser> {
  const query = `
	query findUserByEmail ($email: String!, $organizationId: ID!) {
		allUsers(filter: {
			email: $email
		}) {
			id
			organizations(filter: {
				organization: {
				id: $organizationId
				}
			}) {
				id
				role
			}
		}
	}`;

  const data = {
    email,
    organizationId,
  };

  return api.request<{ allUsers: IUser[] }>(query, data).then((r) => {
    if (r.allUsers.length === 0) {
      throw new Error('No user found');
    }

    return r.allUsers[0];
  });
}

async function updateOrgUserRole(
  api: GraphQLClient,
  existingUser: IUser,
  role: Role,
  organizationId: string,
): Promise<IUser> {
  const mutation = `
	mutation updateOrganizationUserRole ($id:ID!, $role: Role!, $organizationId: ID!) {
		updateOrganizationUserRole(id: $id, role: $role) {
				id
				user {
					id
					organizations(filter: {
						organization: {
						id: $organizationId
						}
					}) {
						id
						role
					}
				}
			}
	}`;

  const data = {
    role,
    organizationId,
    id: existingUser.organizations[0].id,
  };

  return api
    .request<{ updateOrganizationUserRole: IOrganizationUserRole }>(mutation, data)
    .then((r) => r.updateOrganizationUserRole.user);
}

async function inviteOrgUser(api: GraphQLClient, email: string, organizationId: string, role: Role): Promise<IUser> {
  const mutation = `
	mutation inviteOrgUserMutation($organizationId:ID!, $email:String!, $role: Role!) {
		createOrganizationUserRole(role: $role, organizationId: $organizationId, user: {
			name: $email,
			email: $email
		}) {
			id
			user {
				id
				organizations(filter: {
					organization: {
					id: $organizationId
					}
				}) {
					id
					role
				}
			}
		}
	}`;

  const data = {
    email,
    organizationId,
    role,
  };

  return api.request<{ createOrganizationUserRole: IOrganizationUserRole }>(mutation, data).then((r) => {
    return r.createOrganizationUserRole.user;
  });
}

async function addOrgUserRole(api: GraphQLClient, userId: string, organizationId: string, role: Role): Promise<IUser> {
  const mutation = `
	mutation addUserToOrg ($userId:ID!, $organizationId:ID!, $role: Role!) {
		createOrganizationUserRole(role: $role, organizationId: $organizationId, userId: $userId) {
				id
				user {
					id
					organizations(filter: {
						organization: {
						id: $organizationId
						}
					}) {
						id
						role
					}
				}
			}
	}`;

  const data = {
    userId,
    organizationId,
    role,
  };

  return api
    .request<{ createOrganizationUserRole: IOrganizationUserRole }>(mutation, data)
    .then((r) => r.createOrganizationUserRole.user);
}
