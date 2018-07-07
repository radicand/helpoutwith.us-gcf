import { fromEvent, FunctionEvent } from 'graphcool-lib';
import { GraphQLClient } from 'graphql-request';

interface IOrganization {
  id: string;
}

interface IUser {
  id: string;
}

interface IOrganizationUserRole {
  userId: string;
  organizationId: string;
  role: string;
}

interface IEventData {
  name: string;
  description: string;
  location: string;
  link: string;
  timezone: string;
}

export default async (event: FunctionEvent<IEventData>) => {
  // console.log(event);
  const graphcool = fromEvent(event);
  const api = graphcool.api('simple/v1');

  try {
    if (!event.context.auth) {
      return { error: 'User is not authorized to create an activity' };
    }

    const userId = event.context.auth.nodeId;
    const newOrgId = await createOrgMutation(api, event.data);
    const orgAdminMemberId = await createOrgAdminUserMutation(api, newOrgId, userId);

    return {
      data: {
        ...event.data,
        id: newOrgId,
        initialAdminMemberId: orgAdminMemberId,
      },
    };
  } catch (ex) {
    return { error: 'Unable to create new org: ' + ex.message };
  }
};

async function createOrgAdminUserMutation(api: GraphQLClient, organizationId: string, userId: string): Promise<string> {
  const mutation = `
	mutation createOrgUserRole ($organizationId: ID!, $userId: ID!) {
		createOrganizationUserRole(role: Admin, organizationId: $organizationId, userId: $userId) {
			id
		}
	}
	`;

  const data = {
    organizationId,
    userId,
  };

  return api
    .request<{ createOrganizationUserRole: IOrganization }>(mutation, data)
    .then((r) => r.createOrganizationUserRole.id);
}

async function createOrgMutation(api: GraphQLClient, data: IEventData): Promise<string> {
  const mutation = `
	mutation createOrganization($name: String!, $timezone: String!, $description: String, $location: String, $link: String) {
		createOrganization(name: $name, timezone: $timezone, description: $description, location: $location, link: $link) {
			id
			name
			timezone
			description
			location
			link
		}
	}
	`;

  return api.request<{ createOrganization: IOrganization }>(mutation, data).then((r) => r.createOrganization.id);
}
