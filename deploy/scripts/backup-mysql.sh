#!/usr/bin/env bash
# 每日全量备份（cron 02:30）。RDS 环境优先用云厂商自动备份 + binlog 7 天，本脚本用于自建库或额外异地副本。
#   30 2 * * * /opt/shitu/backup-mysql.sh >> /var/log/shitu/backup.log 2>&1
set -euo pipefail
: "${DB_HOST:?}" "${DB_USER:?}" "${DB_PASSWORD:?}"
DB_NAME="${DB_NAME:-shitu}"
DIR="${BACKUP_DIR:-/data/backup/mysql}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$DIR"
FILE="$DIR/${DB_NAME}-$(date +%F-%H%M).sql.gz"
# --single-transaction：InnoDB 一致性快照不锁表；--routines --triggers：含 trg_user_source_immutable
MYSQL_PWD="$DB_PASSWORD" mysqldump -h "$DB_HOST" -u "$DB_USER" --single-transaction --routines --triggers \
  --set-gtid-purged=OFF --default-character-set=utf8mb4 "$DB_NAME" | gzip > "$FILE.part"
mv "$FILE.part" "$FILE"
# 备份文件里的手机号 / 身份证 / 姓名都是密文（AES-GCM），密钥不在库里；恢复必须使用同一套 SHITU_ENC_KEY / SHITU_MAC_KEY
find "$DIR" -name "${DB_NAME}-*.sql.gz" -mtime +"$KEEP_DAYS" -delete
echo "$(date '+%F %T') backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
