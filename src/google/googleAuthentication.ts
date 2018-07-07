import { fromEvent, FunctionEvent } from 'graphcool-lib';
import { GraphQLClient } from 'graphql-request';
import * as fetch from 'isomorphic-fetch';

interface IUser {
  id: string;
  googleUserId: string;
  name: string;
  email: string;
  photoLink: string;
}

interface IGoogleUser {
  id: string;
  email: string | null;
  name: string;
  picture: string | null;
  sub: string;
}

interface IEventData {
  googleToken: string;
}

export default async (event: FunctionEvent<IEventData>) => {
  // console.log(event);

  try {
    const graphcool = fromEvent(event);
    const api = graphcool.api('simple/v1');

    const { googleToken } = event.data;

    // call google API to obtain user data
    let googleUser;
    try {
      googleUser = await getGoogleUser(googleToken);
    } catch (ex) {
      throw new Error('Google token check failed: ' + ex.message);
    }

    // get graphcool user by google id
    const user: IUser = await getGraphcoolUser(api, googleUser).then((r) => r.User);

    // check if graphcool user exists, and create new one if not
    let userId: string | null = null;
    if (!user) {
      userId = await createGraphcoolUser(api, googleUser);
    } else {
      userId = user.id;
      await updateGraphcoolUser(api, user, googleUser);
    }

    // generate node token for User node
    const token = await graphcool.generateAuthToken(userId, 'User');

    return { data: { id: userId, token } };
  } catch (e) {
    // console.log(e.message);
    return { error: 'An unexpected error occured during authentication.' };
  }
};

async function getGoogleUser(googleToken: string): Promise<IGoogleUser> {
  // XXX Fix Invalid Value thing here
  // XXX 2018-01-22 - does the above error still exist?
  const endpoint = `https://www.googleapis.com/oauth2/v3/tokeninfo?id_token=${googleToken}`;
  const data = await fetch(endpoint).then((response) => response.json());

  if (data.error_description) {
    throw new Error(data.error_description);
  }

  return data;
}

async function getGraphcoolUser(api: GraphQLClient, googleUser: IGoogleUser): Promise<{ User }> {
  const query = `
    query getUser($email: String!) {
      User(email: $email) {
				id
				googleUserId
				name
				email
				photoLink
      }
    }
	`;

  const variables = {
    email: googleUser.email,
  };

  return api.request<{ User }>(query, variables);
}

async function createGraphcoolUser(api: GraphQLClient, googleUser: IGoogleUser): Promise<string> {
  const mutation = `
    mutation createUser($sub: String!, $name: String!, $picture: String, $email: String!) {
      createUser(
				googleUserId: $sub,
				name: $name,
				photoLink: $picture,
				email: $email
      ) {
        id
      }
    }
	`;

  const { sub, name, picture, email } = googleUser;

  const variables = {
    sub,
    name,
    picture,
    email,
  };

  return api.request<{ createUser: IUser }>(mutation, variables).then((r) => r.createUser.id);
}

async function updateGraphcoolUser(api: GraphQLClient, user: IUser, googleUser: IGoogleUser): Promise<string> {
  if (user.email === googleUser.email && user.name === googleUser.name && user.photoLink === googleUser.picture) {
    return Promise.resolve('');
  } else {
    const mutation = `
    mutation updateUser($id: ID!, $name: String!, $picture: String, $email: String!) {
      updateUser(
				id: $id,
				name: $name,
				photoLink: $picture,
				email: $email
      ) {
        id
      }
    }
	`;

    const { name, picture, email } = googleUser;
    const id = user.id;

    const variables = {
      id,
      name,
      picture,
      email,
    };

    return api.request<{ updateUser: IUser }>(mutation, variables).then((r) => r.updateUser.id);
  }
}
