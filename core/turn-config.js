// TURN relay for players whose computers can't connect directly (strict routers, school networks): traffic goes
// through a nearby TURN server instead, at almost direct-link speed. Free Metered account (metered.ca), owner-approved.
// Either list a TURN credential's servers directly (SERVERS), or set app + apiKey to fetch fresh logins
// (dashboard → TURN Server → credential → Show API Key). Never put the account's Secret Key here: this file is public.
// If the free monthly allowance gets used up by someone else, create a new credential in the dashboard and replace it.
const user = '051be9ab6ed9dc1020fbe1e3', pass = 'B3hNHjJHQJDsY/YB';
export const TURN = {
  app: '', apiKey: '',
  servers: [
    { urls: 'turn:global.relay.metered.ca:80', username: user, credential: pass },
    { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: user, credential: pass },
    { urls: 'turn:global.relay.metered.ca:443', username: user, credential: pass },
    { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: user, credential: pass },
  ],
};
