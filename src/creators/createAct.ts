import { fromEvent, FunctionEvent } from 'graphcool-lib';
import { GraphQLClient } from 'graphql-request';

interface IActivity {
  id: string;
}

interface IUser {
  id: string;
}

interface IActivityUserRole {
  userId: string;
  activityId: string;
  role: string;
}

interface IEventData {
  name: string;
  description: string;
  location: string;
  organizationId: string;
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
    const newActId = await createActMutation(api, event.data);
    const actAdminMemberId = await createActAdminUserMutation(api, newActId, userId);

    return {
      data: {
        ...event.data,
        id: newActId,
        initialAdminMemberId: actAdminMemberId,
      },
    };
  } catch (ex) {
    return { error: 'Unable to create new activity: ' + ex.message };
  }
};

async function createActAdminUserMutation(api: GraphQLClient, activityId: string, userId: string): Promise<string> {
  const mutation = `
	mutation createActivityUserRole ($activityId: ID!, $userId: ID!) {
		createActivityUserRole(role: Admin, activityId: $activityId, userId: $userId) {
			id
		}
	}
	`;

  const data = {
    activityId,
    userId,
  };

  return api.request<{ createActivityUserRole: IActivity }>(mutation, data).then((r) => r.createActivityUserRole.id);
}

async function createActMutation(api: GraphQLClient, data: IEventData): Promise<string> {
  const mutation = `
	mutation createActivity($name: String!, $description: String, $location: String, $organizationId: ID!) {
		createActivity(name: $name, description: $description, location: $location, organizationId: $organizationId) {
			id
			name
			description
			location
		}
	}
	`;

  return api.request<{ createActivity: IActivity }>(mutation, data).then((r) => r.createActivity.id);
}
