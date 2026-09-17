#!/bin/bash
BASE=/home/ubuntu/srs-manager/backend
mv /tmp/srs-deploy/database.js $BASE/database.js
mv /tmp/srs-deploy/aliyun-dns.js $BASE/services/aliyun-dns.js
mv /tmp/srs-deploy/dns-service.js $BASE/services/dns-service.js
mv /tmp/srs-deploy/cdn-service.js $BASE/services/cdn-service.js
mv /tmp/srs-deploy/dns-auth.js $BASE/routes/dns-auth.js
mv /tmp/srs-deploy/dns-records.js $BASE/routes/dns-records.js
mv /tmp/srs-deploy/cdn-channels.js $BASE/routes/cdn-channels.js
mv /tmp/srs-deploy/settings.js $BASE/routes/settings.js
mv /tmp/srs-deploy/server.js $BASE/server.js
rm -rf /tmp/srs-deploy
sudo systemctl restart srs-manager
sleep 2
sudo systemctl status srs-manager --no-pager | head -5
