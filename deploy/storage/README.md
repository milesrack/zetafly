# Server storage

The hourly timer cleans up old Zetafly images and emails when disk or inode usage reaches 80%.

## Install

Run from the repository root. Replace `VERIFIED_RELEASE_SHA` with a known-good release on the host. The alert uses Bash, curl, and jq.

```sh
sudo install -d -m 755 /etc/zetafly-storage /etc/systemd/journald.conf.d
sudo install -m 755 deploy/storage/zetafly-{prune-images,disk-alert} /usr/local/sbin/
sudo install -m 644 deploy/storage/email.html /etc/zetafly-storage/
sudo install -m 644 deploy/storage/90-storage-limits.conf /etc/systemd/journald.conf.d/
sudo install -m 644 deploy/storage/zetafly-storage.{service,timer} /etc/systemd/system/
sudo -u deploy touch /var/www/zetafly/shared/deploy.lock
sudo ln -s /var/www/zetafly/releases/VERIFIED_RELEASE_SHA /etc/zetafly-storage/rollback
sudo touch /etc/zetafly-storage/alert.conf
sudo chmod 600 /etc/zetafly-storage/alert.conf
sudoedit /etc/zetafly-storage/alert.conf
```

In `/etc/zetafly-storage/alert.conf`, set `ZETAFLY_ALERT_TO`. Set `ZETAFLY_IMAGE_REPOSITORY` or `ZETAFLY_STATUS_URL` if the defaults differ from your deployment. The alert uses `EMAIL_FROM` and `RESEND_API_KEY` from `/var/www/zetafly/shared/.env`.

## Enable and test

```sh
sudo systemctl restart systemd-journald
sudo systemctl daemon-reload
sudo systemctl enable --now zetafly-storage.timer
sudo systemctl start zetafly-storage.service
sudo journalctl -u zetafly-storage.service -n 30
sudo systemd-run --wait --pipe --collect \
  --property=EnvironmentFile=/etc/zetafly-storage/alert.conf \
  /usr/local/sbin/zetafly-disk-alert --test-email
```
