#!/usr/bin/env bash
# 预览环境一键安装（Ubuntu 24.04+，root 执行）。可重复执行：已生成的密钥和密码不会被覆盖。
# 前置：把下列文件传到 /opt/shitu/upload/
#   shitu-server.jar  seeker.tgz staff.tgz console.tgz ops.tgz  shitu-preview.nginx.conf
# 用法：PUBLIC_BASE=http://<公网IP>:8888 bash setup.sh
set -euo pipefail
UP=/opt/shitu/upload
: "${PUBLIC_BASE:?需要 PUBLIC_BASE，例如 http://1.2.3.4:8888}"
export DEBIAN_FRONTEND=noninteractive

echo "== 1. 安装软件"
apt-get update -qq
apt-get install -y -qq mysql-server redis-server nginx openjdk-17-jre-headless openssl >/dev/null

echo "== 2. 账号与目录"
id shitu >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -d /opt/shitu shitu
mkdir -p /opt/shitu /etc/shitu /var/log/shitu /data/shitu/uploads /srv/shitu
chown -R shitu:shitu /var/log/shitu /data/shitu

echo "== 3. 密钥（只在第一次生成）"
ENV=/etc/shitu/shitu.env
if [ ! -f "$ENV" ]; then
  umask 077
  DB_PASSWORD=$(openssl rand -hex 16)
  REDIS_PASSWORD=$(openssl rand -hex 16)
  OPS_PASSWORD="St$(openssl rand -hex 6)!9"
  cat > "$ENV" <<EOF
SPRING_PROFILES_ACTIVE=preview
DB_HOST=127.0.0.1
DB_NAME=shitu
DB_USER=shitu
DB_PASSWORD=$DB_PASSWORD
REDIS_HOST=127.0.0.1
REDIS_PASSWORD=$REDIS_PASSWORD
SHITU_ENC_KEY=$(openssl rand -base64 32)
SHITU_MAC_KEY=$(openssl rand -base64 32)
SHITU_JWT_SECRET=$(openssl rand -base64 48)
SHITU_OPS_INIT_PASSWORD=$OPS_PASSWORD
SHITU_STORAGE_DIR=/data/shitu/uploads
SHITU_LOG_DIR=/var/log/shitu
SHITU_H5_PUBLIC_BASE=$PUBLIC_BASE
SHITU_H5_ENTRY=/
EOF
  chmod 600 "$ENV"
  umask 022
fi
sed -i "s#^SHITU_H5_PUBLIC_BASE=.*#SHITU_H5_PUBLIC_BASE=$PUBLIC_BASE#" "$ENV"
# shellcheck disable=SC1090
set -a; . "$ENV"; set +a

echo "== 4. MySQL（只监听本机）"
cat > /etc/mysql/mysql.conf.d/shitu.cnf <<'EOF'
[mysqld]
bind-address = 127.0.0.1
mysqlx-bind-address = 127.0.0.1
character-set-server = utf8mb4
collation-server = utf8mb4_0900_ai_ci
default-time-zone = '+08:00'
log_bin_trust_function_creators = 1
innodb_buffer_pool_size = 1G
EOF
systemctl enable -q mysql
systemctl restart mysql
mysql -uroot <<EOF
CREATE DATABASE IF NOT EXISTS shitu CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'shitu'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER 'shitu'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON shitu.* TO 'shitu'@'127.0.0.1';
FLUSH PRIVILEGES;
EOF

echo "== 5. Redis（只监听本机 + 密码）"
RC=/etc/redis/redis.conf
sed -i -E "s/^#? ?bind .*/bind 127.0.0.1/; s/^#? ?requirepass .*/requirepass $REDIS_PASSWORD/" "$RC"
grep -q "^requirepass " "$RC" || echo "requirepass $REDIS_PASSWORD" >> "$RC"
systemctl enable -q redis-server
systemctl restart redis-server

echo "== 6. 后端服务"
install -o root -g root -m 644 "$UP/shitu-server.jar" /opt/shitu/shitu-server.jar
cat > /etc/systemd/system/shitu.service <<'EOF'
[Unit]
Description=Shitu server (preview)
After=network.target mysql.service redis-server.service
Wants=mysql.service redis-server.service

[Service]
User=shitu
Group=shitu
EnvironmentFile=/etc/shitu/shitu.env
WorkingDirectory=/opt/shitu
ExecStart=/usr/bin/java -Xms512m -Xmx1536m -Duser.timezone=Asia/Shanghai -XX:+ExitOnOutOfMemoryError -jar /opt/shitu/shitu-server.jar
SuccessExitStatus=143
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q shitu
systemctl restart shitu

echo "== 7. 前端与 Nginx"
for a in seeker staff console ops; do
  rm -rf "/srv/shitu/$a.new" && mkdir -p "/srv/shitu/$a.new"
  tar -xzf "$UP/$a.tgz" -C "/srv/shitu/$a.new"
  rm -rf "/srv/shitu/$a.old"; [ -d "/srv/shitu/$a" ] && mv "/srv/shitu/$a" "/srv/shitu/$a.old"
  mv "/srv/shitu/$a.new" "/srv/shitu/$a"; rm -rf "/srv/shitu/$a.old"
done
chmod -R a+rX /srv/shitu
cat > /etc/nginx/snippets/shitu-preview-proxy.conf <<'EOF'
proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $http_host;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_connect_timeout 5s;
proxy_read_timeout 60s;
EOF
install -m 644 "$UP/shitu-preview.nginx.conf" /etc/nginx/conf.d/shitu-preview.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable -q nginx
systemctl reload nginx || systemctl restart nginx

echo "== 8. 等后端启动"
for i in $(seq 1 60); do
  if curl -fs http://127.0.0.1:8080/actuator/health | grep -q UP; then echo "backend UP"; break; fi
  sleep 3
done
curl -s -o /dev/null -w "nginx /            -> %{http_code}\n" http://127.0.0.1:8888/
curl -s -o /dev/null -w "nginx /admin/      -> %{http_code}\n" http://127.0.0.1:8888/admin/
curl -s -o /dev/null -w "nginx /api/v1/dict -> %{http_code}\n" http://127.0.0.1:8888/api/v1/dict
echo "平台管理员初始密码在 /etc/shitu/shitu.env 的 SHITU_OPS_INIT_PASSWORD（账号 admin，首次登录强制修改）"
