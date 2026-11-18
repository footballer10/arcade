// TURN relay for players whose computers can't connect directly (strict routers, school networks): traffic goes
// through a nearby TURN server instead, at almost direct-link speed. Uses a free Metered account (metered.ca):
//   app    = your Metered app name (the part before .metered.live)
//   apiKey = the API key of ONE TURN credential (dashboard → TURN Server → credential → Show API Key).
//            It only hands out TURN logins, so it is fine in public code; never put the account's Secret Key here.
// Leave both empty to use only the public STUN servers + the MQTT relay.
export const TURN = { app: '', apiKey: '' };
