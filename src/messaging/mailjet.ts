import { FunctionEvent } from 'graphcool-lib';
import * as mj from 'node-mailjet';

const mailjet = mj.connect(process.env.MJ_APIKEY_PUBLIC, process.env.MJ_APIKEY_PRIVATE, {
  url: 'api.mailjet.com', // default is the API url
  version: 'v3.1', // default is '/v3'
  perform_api_call: true, // used for tests. default is true
});

interface IEmailAddress {
  name: string;
  email: string;
}

interface ITemplateOptions {
  to: IEmailAddress[];
  cc?: IEmailAddress[];
  templateId: number;
  variables: {
    [key: string]: any;
  };
}

interface IEventData {
  to: IEmailAddress[];
  cc?: IEmailAddress[];
  templateId: number;
  variables: string;
}

export async function sendTemplate(options: ITemplateOptions) {
  if (!process.env.MJ_APIKEY_PUBLIC) {
    // tslint:disable-next-line:no-console
    console.log('Please provide a valid MJ_APIKEY_PUBLIC!');
    return { error: 'Module not configured correctly.' };
  }

  if (!process.env.MJ_APIKEY_PRIVATE) {
    // tslint:disable-next-line:no-console
    console.log('Please provide a valid MJ_APIKEY_PRIVATE!');
    return { error: 'Module not configured correctly.' };
  }

  try {
    const { to, cc, templateId, variables } = options;

    const result = await mailjet.post('send').request({
      Messages: [
        {
          From: {
            Email: 'mailjet@noreply.helpoutwith.us',
            Name: 'Help Out With Us',
          },
          To: to.map((address) => ({
            Email: address.email,
            Name: address.name,
          })),
          Cc: cc
            ? cc.map((address) => ({
                Email: address.email,
                Name: address.name,
              }))
            : [],
          TemplateID: templateId,
          TemplateLanguage: true,
          Variables: variables,
        },
      ],
    });

    return { data: { success: result.body.Messages.map((message) => message.Status === 'success') } };
  } catch (e) {
    // console.log(e.message);
    return { error: e.message };
  }
}

export default async (event: FunctionEvent<IEventData>) => {
  // if (...) {
  //   throw new Error('You are not authorized to execute this function');
  // }

  try {
    JSON.parse(event.data.variables);
  } catch (ex) {
    throw new Error('variables must be a valid JSON object');
  }

  throw new Error('mutation currently disabled');

  // return sendTemplate(event.data);
};
