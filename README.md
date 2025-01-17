# edge-change-server

This server checks for on-chain changes to addresses. Clients can subscribe to a bundle of address across one or more chains, with a starting block height. If something has changed, the server will report on which address on which chain has been affected. The server does not say what has changed - the client is responsible for re-syncing the address on its own.

## Setup

You need Node.js installed.

### Set up logging

Run these commands as a server admin:

```sh
mkdir /var/log/pm2
chown edgy /var/log/pm2
cp ./docs/logrotate /etc/logrotate.d/changeServer
```

### Manage server using `pm2`

First, install pm2 to run at startup:

```sh
yarn global add pm2
pm2 startup # Then do what it says
```

Next, tell pm2 how to run the server script:

```sh
# install:
pm2 start pm2.json
pm2 save

# check status:
pm2 monit
tail -f /var/log/changeServer.log

# manage:
pm2 restart pm2.json
pm2 reload pm2.json
pm2 stop pm2.json
```

### Updating

To update the code running on the production server, use the following procedure:

```sh
git pull
yarn
yarn prepare
pm2 restart pm2.json
```

Each deployment should come with its own version bump, changelog update, and git tag.
