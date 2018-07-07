import { fromEvent, FunctionEvent } from 'graphcool-lib';
import { GraphQLClient } from 'graphql-request';

interface IUser {
  id: string;
  name: string;
  email: string;
  photoLink: string;
}

export default async (event: FunctionEvent<{}>) => {
  // console.log(event)

  try {
    // no logged in user
    if (!event.context.auth || !event.context.auth.nodeId) {
      return { data: null };
    }

    const userId = event.context.auth.nodeId;
    const graphcool = fromEvent(event);
    const api = graphcool.api('simple/v1');

    // get user by id
    const user: IUser = await getUser(api, userId);

    // no logged in user
    if (!user || !user.id) {
      return { data: null };
    }

    return { data: user };
  } catch (e) {
    // console.log(e)
    return { error: 'An unexpected error occured during authentication.' };
  }
};

export async function getUser(api: GraphQLClient, id: string): Promise<IUser> {
  const query = `
    query getUser($id: ID!) {
      User(id: $id) {
				id
				name
				email
				photoLink
      }
    }
  `;

  const variables = {
    id,
  };

  return api.request<{ User }>(query, variables).then((r) => r.User);
}
