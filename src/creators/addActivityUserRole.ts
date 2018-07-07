import { fromEvent, FunctionEvent } from 'graphcool-lib';
import { GraphQLClient } from 'graphql-request';
import { getUser } from '../google/loggedInUser';
import { sendTemplate } from '../messaging/mailjet';

interface IUser {
  id: string;
  organizations: IOrganizationUserRole[];
}

interface IOrganizaton {
  id: string;
  name: string;
}

interface IActivity {
  id: string;
  name: string;
  organization: IOrganizaton;
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

interface IActivityUserRole {
  id: string;
  user: IUser;
  role: Role;
}

interface IEventData {
  activityId: string;
  role: Role;
  userId: string;
}

export default async (event: FunctionEvent<IEventData>) => {
  const graphcool = fromEvent(event);
  const api = graphcool.api('simple/v1');

  const { activityId, role, userId } = event.data;

  try {
    const isAdmin = event.context.auth && (await isAdminRole(api, activityId, event.context.auth.nodeId));
    if (!isAdmin) {
      return { error: 'Current user is not authorized to add members to this activity' };
    }

    const currentUser = await getUser(api, event.context.auth.nodeId);

    let foundUser;
    const activity = await lookupDataByActivityId(api, activityId);
    let updateHappened = false;

    try {
      foundUser = await lookupUserByUserId(api, userId, activity);
    } catch (ex) {
      throw new Error('No such user found - please request an admin to invite them to the organization first');
    }

    if (foundUser.organizations.length === 0) {
      throw new Error('No such user found - please request an admin to invite them to the organization first');
    } else if (foundUser.activities.length === 0) {
      foundUser = await addActivityUserRole(api, foundUser, activityId, role);
      updateHappened = true;
    } else if (foundUser.activities[0].role !== role) {
      foundUser = await updateActivityUserRole(api, foundUser.activities[0].id, role);
      updateHappened = true;
    }

    if (updateHappened) {
      sendTemplate({
        to: [ { email: foundUser.email, name: foundUser.email } ],
        cc: [ { email: currentUser.email, name: currentUser.email } ],
        templateId: 302192,
        variables: {
          to_email: foundUser.name,
          created_by: currentUser.name, // who invited
          organization_name: activity.organization.name,
          activity_name: activity.name,
          role_name: role.toString(),
        },
      });
    }

    return {
      data: {
        userId: foundUser.id,
        activityId,
        role,
        activityUserRoleId: foundUser.activities[0].id,
      },
    };
  } catch (ex) {
    // console.log(ex.message);
    return { error: 'Unexpected error adding/updating user activity link' };
  }
};

async function isAdminRole(api: GraphQLClient, activityId: string, userId: string): Promise<boolean> {
  const query = `
  query isAdmin ($userId: ID!, $activityId: ID!) {
	allActivities(filter: {
		id: $activityId,
  OR: [
	{members_some: {
	  role: Admin,
	  user: {
		id: $userId
	  }
	}},
	{
	  organization: {
		members_some: {
		  role: Admin,
		  user: {
			id: $userId
		  }
		}
	  }
	}
  ]
}) {
id
}
}`;

  const data = {
    userId,
    activityId,
  };

  return api.request<{ allActivities: IActivity[] }>(query, data).then((r) => {
    return r.allActivities.length === 1;
  });
}

async function lookupDataByActivityId(api: GraphQLClient, activityId: string): Promise<IActivity> {
  const query = `
	query lookupDataByActivityId ($activityId: ID!) {
		Activity(id: $activityId) {
			id
			name
			organization {
				id
				name
			}
		}
	}`;

  const data = {
    activityId,
  };

  return api.request<{ Activity }>(query, data).then((r) => r.Activity);
}

async function lookupUserByUserId(api: GraphQLClient, userId: string, activity: IActivity): Promise<IUser> {
  const query = `
	query lookupUserByUserId ($userId: ID!, $activityId: ID!, $organizationId: ID!) {
		User(id: $userId) {
			id
			name
			email
			organizations(filter: {
				organization: {
				id: $organizationId
				}
			}) {
				id
				role
			}
			activities(filter: {
				activity: {
				id: $activityId
				}
			}) {
				id
				role
			}
		}
	}`;

  const data = {
    userId,
    activityId: activity.id,
    organizationId: activity.organization.id,
  };

  return api.request<{ User }>(query, data).then((r) => r.User);
}

async function updateActivityUserRole(api: GraphQLClient, activityUserRoleId: string, role: Role): Promise<IUser> {
  const mutation = `
	mutation updateActivityUserRole ($id:ID!, $role: Role!) {
		updateActivityUserRole(id: $id, role: $role) {
				id
				user {
					id
					name
					email
					activities(filter: {
						activity: {
						id: $activityId
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
    activityUserRoleId,
  };

  return api
    .request<{ updateOrganizationUserRole: IOrganizationUserRole }>(mutation, data)
    .then((r) => r.updateOrganizationUserRole.user);
}

async function addActivityUserRole(
  api: GraphQLClient,
  existingUser: IUser,
  activityId: string,
  role: Role,
): Promise<IUser> {
  const mutation = `
	mutation addActivityUserRole ($userId: ID!, $activityId: ID!, $role: Role!) {
		createActivityUserRole(role: $role, activityId: $activityId, userId: $userId) {
				id
				user {
					id
					name
					email
					activities(filter: {
						activity: {
						id: $activityId
						}
					}) {
						id
						role
					}
				}
			}
	}`;

  const data = {
    userId: existingUser.id,
    activityId,
    role,
  };

  return api
    .request<{ createActivityUserRole: IActivityUserRole }>(mutation, data)
    .then((r) => r.createActivityUserRole.user);
}
