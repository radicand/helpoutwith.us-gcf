import { fromEvent, FunctionEvent } from 'graphcool-lib';
import { GraphQLClient } from 'graphql-request';
import * as luxon from 'luxon';
import { sendTemplate } from '../messaging/mailjet';

const FULL_DATE_FORMAT = {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
};
const SHORT_DATE_FORMAT = luxon.DateTime.TIME_SIMPLE;

interface IUser {
  name: string;
  email: string;
  spots: Array<{
    spot: {
      activity: {
        name: string;
        organization: IOrganization;
      };
      startsAt: string;
      endsAt: string;
    };
  }>;
}

interface IActivity {
  name: string;
  members: Array<{
    user: {
      name: string;
      email: string;
    };
  }>;
  spots: Array<{
    startsAt: string;
    endsAt: string;
    numberNeeded: number;
    members: Array<{
      status: 'Confirmed' | 'Absent' | 'Canceled';
      user: {
        name: string;
        email: string;
      };
    }>;
  }>;
  organization: IOrganization;
}

interface IOrganization {
  name: string;
  timezone: string;
}

interface ISendUpcomingRemindersPayload {
  notificationsSent: number;
  errors: string[];
}

interface IEventData {
  daysOut: number;
  filled: boolean;
  unfilled: boolean;
}

export default async (event: FunctionEvent<IEventData>) => {
  // check if user is authenticated
  if (!event.context.auth || !event.context.auth.nodeId) {
    return { error: 'Invalid token supplied' };
  }

  // check if root
  if (event.context.auth.typeName !== 'PAT') {
    return { error: 'Insufficient permissions to execute this mutation' };
  }

  const graphcool = fromEvent(event);
  const api = graphcool.api('simple/v1');

  const { daysOut, filled, unfilled } = event.data;

  try {
    // TODO: Add some sort of authorization here
    const unfilledUpcomingSpots =
      (unfilled && (await getUnfilledUpcomingSpots(api, daysOut))) || [];
    const myUpcomingSpots =
      (filled && (await getMyUpcomingSpots(api, daysOut))) || [];

    let notificationsSent = 0;
    const errors = [];

    if (myUpcomingSpots.length > 0) {
      await Promise.all(
        myUpcomingSpots.map((user) => {
          return sendTemplate({
            to: [{ email: user.email, name: user.name }],
            templateId: 349788,
            variables: {
              name: user.name,
              spots: user.spots.map((spot) => ({
                activity: spot.spot.activity,
                starts: luxon.DateTime.fromISO(spot.spot.startsAt)
                  .setZone(spot.spot.activity.organization.timezone)
                  .toLocaleString(FULL_DATE_FORMAT),
                ends: luxon.DateTime.fromISO(spot.spot.endsAt)
                  .setZone(spot.spot.activity.organization.timezone)
                  .toLocaleString(
                    luxon.DateTime.fromISO(spot.spot.startsAt)
                      .setZone(spot.spot.activity.organization.timezone)
                      .toFormat('DD') ===
                    luxon.DateTime.fromISO(spot.spot.endsAt)
                      .setZone(spot.spot.activity.organization.timezone)
                      .toFormat('DD')
                      ? SHORT_DATE_FORMAT
                      : FULL_DATE_FORMAT,
                  ),
              })),
            },
          }).then((result) => {
            if (result.data && result.data.success) {
              notificationsSent++;
            } else if (result.error) {
              errors.push(result.error);
            }
          });
        }),
      );
    }

    if (unfilledUpcomingSpots.length > 0) {
      await Promise.all(
        unfilledUpcomingSpots.map((activity) => {
          return sendTemplate({
            to: activity.members
              .filter((actMember) => {
                const absentSpotsForPerson = activity.spots.filter((spot) => {
                  return spot.members.find(
                    (member) =>
                      member.user.email === actMember.user.email &&
                      member.status === 'Absent',
                  );
                });
                return absentSpotsForPerson.length !== activity.spots.length;
              })
              .map((member) => ({
                email: member.user.email,
                name: member.user.name,
              })),
            templateId: 477313,
            variables: {
              team: activity.name,
              spots: activity.spots.map((spot) => ({
                starts: luxon.DateTime.fromISO(spot.startsAt)
                  .setZone(activity.organization.timezone)
                  .toLocaleString(FULL_DATE_FORMAT),
                ends: luxon.DateTime.fromISO(spot.endsAt)
                  .setZone(activity.organization.timezone)
                  .toLocaleString(
                    luxon.DateTime.fromISO(spot.startsAt)
                      .setZone(activity.organization.timezone)
                      .toFormat('DD') ===
                    luxon.DateTime.fromISO(spot.endsAt)
                      .setZone(activity.organization.timezone)
                      .toFormat('DD')
                      ? SHORT_DATE_FORMAT
                      : FULL_DATE_FORMAT,
                  ),
              })),
            },
          }).then((result) => {
            if (result.data && result.data.success) {
              notificationsSent++;
            } else if (result.error) {
              errors.push(result.error);
            }
          });
        }),
      );
    }

    return {
      data: {
        errors,
        notificationsSent,
      },
    };
  } catch (ex) {
    return {
      error: 'Unexpected error sending notifications',
      details: ex.message,
    };
  }
};

async function getUnfilledUpcomingSpots(api: GraphQLClient, daysOut: number) {
  const startRange = luxon.DateTime.local()
    .plus({ days: daysOut })
    .startOf('day');
  const endRange = startRange.endOf('day');

  const query = `
  query getUpcomingSpots($startRange: DateTime!, $endRange: DateTime) {
    allActivities(filter: {
      spots_some: {
        startsAt_gte: $startRange,
        startsAt_lt: $endRange
      }
    }) {
			organization {
				timezone
			}
      name
      members {
        user {
          name
          email
        }
      }
      spots(filter:{
        startsAt_gte: $startRange,
        startsAt_lt: $endRange
      }) {
        startsAt
        endsAt
        numberNeeded
        members {
					status
          user {
            name
            email
          }
        }
      }
    }
  }`;

  const data = {
    endRange: endRange.toISO(),
    startRange: startRange.toISO(),
  };

  return api.request<{ allActivities: IActivity[] }>(query, data).then((r) => {
    const activities = r.allActivities.map((activity) => {
      activity.spots = activity.spots.filter((spot) => {
        return spot.numberNeeded > spot.members.length;
      });

      if (activity.spots.length === 0) {
        return;
      }

      return activity;
    });
    return activities.filter((activity) => activity);
  });
}

async function getMyUpcomingSpots(api: GraphQLClient, daysOut: number) {
  const startRange = luxon.DateTime.local()
    .plus({ days: daysOut })
    .startOf('day');
  const endRange = startRange.endOf('day');

  const query = `
  query getMyUpcomingSpots($startRange: DateTime!, $endRange: DateTime) {
    allUsers(filter: {
      spots_some: {
        status: Confirmed,
        spot: {
          startsAt_gte: $startRange,
          startsAt_lt: $endRange
        }
      }
    }) {
      name
      email
      spots(filter: {
        status: Confirmed,
        spot: {
          startsAt_gte: $startRange,
          startsAt_lt: $endRange
        }
      }) {
        spot {
          activity {
            name
            organization {
              name
              timezone
            }
          }
          startsAt
          endsAt
        }
      }
    }
  }`;

  const data = {
    endRange: endRange.toISO(),
    startRange: startRange.toISO(),
  };

  return api.request<{ allUsers: IUser[] }>(query, data).then((r) => {
    return r.allUsers;
  });
}
