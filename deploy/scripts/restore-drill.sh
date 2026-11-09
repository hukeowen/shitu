#!/usr/bin/env bash
# 恢复演练（每月一次）：把最新备份恢复到临时库 shitu_restore，核对关键表行数与 Flyway 版本，然后删除临时库。
set -euo pipefail
: "${DB_HOST:?}" "${DB_USER:?}" "${DB_PASSWORD:?}"
DIR="${BACKUP_DIR:-/data/backup/mysql}"
LATEST="$(ls -1t "$DIR"/*.sql.gz | head -1)"
export MYSQL_PWD="$DB_PASSWORD"
mysql -h "$DB_HOST" -u "$DB_USER" -e "DROP DATABASE IF EXISTS shitu_restore; CREATE DATABASE shitu_restore DEFAULT CHARSET utf8mb4;"
gunzip -c "$LATEST" | mysql -h "$DB_HOST" -u "$DB_USER" shitu_restore
for t in company member \`user\` job application employment contract billing_daily monthly_bill advance_request; do
  src=$(mysql -N -h "$DB_HOST" -u "$DB_USER" -e "SELECT COUNT(*) FROM shitu.$t")
  dst=$(mysql -N -h "$DB_HOST" -u "$DB_USER" -e "SELECT COUNT(*) FROM shitu_restore.$t")
  echo "$t: 生产 $src / 恢复 $dst"
done
mysql -N -h "$DB_HOST" -u "$DB_USER" -e "SELECT MAX(version) FROM shitu_restore.flyway_schema_history WHERE success = 1"
mysql -h "$DB_HOST" -u "$DB_USER" -e "DROP DATABASE shitu_restore"
echo "restore drill ok: $LATEST"
