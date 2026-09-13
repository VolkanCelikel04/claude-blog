# Tek Sunucuda Kurulum (API + PostgreSQL aynı makinede)

API'yi veritabanının zaten kurulu olduğu sunucuda çalıştırmak için hazırlanmış
adımlar. Bu yerleşimde PostgreSQL'in dış dünyaya açık bir portu olmasına gerek
yoktur: API ona `127.0.0.1` üzerinden bağlanır.

```
┌─────────────────── sunucunuz ───────────────────┐
│                                                 │
│  nginx :443 ──► API :3000 ──► PostgreSQL :5432  │
│  (TLS)         (127.0.0.1)    (127.0.0.1)       │
│    │                                            │
│    └──► apps/web/dist  (React arayüzü)          │
└─────────────────────────────────────────────────┘
```

## Gereksinimler

| Bileşen | Sürüm | Not |
|---|---|---|
| Node.js | **22 LTS veya üstü** | `@node-rs/argon2` glibc'li dağıtımlarda hazır ikili kullanır; Alpine kullanıyorsanız musl derlemesi gerekir |
| PostgreSQL | 16 | Zaten kurulu |
| nginx | herhangi | TLS sonlandırma + arayüzü sunmak için |
| rsync, curl | - | Kurulum betiği kullanır |

Node 22 kurulumu (Debian/Ubuntu):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

## Kurulum

```bash
# 1. Kodu sunucuya alın
sudo mkdir -p /srv/src && cd /srv/src
git clone https://github.com/VolkanCelikel04/claude-blog.git
cd claude-blog
git checkout claude/multi-tenant-saas-architecture-wb32ds
cd vgantt

# 2. Kurulum betiğini çalıştırın (ilk seferde ayar dosyasını oluşturur ve durur)
sudo ./deploy/install.sh

# 3. Sırları doldurun
sudo nano /etc/vgantt/api.env
#    DB_APP_PASSWORD, DB_PLATFORM_PASSWORD, JWT_SECRET
#    JWT_SECRET üretmek için:  openssl rand -base64 48

# 4. Veritabanını kurun ve servisi başlatın
sudo ./deploy/install.sh --with-db --with-web
```

Betik idempotenttir; her güncellemede tekrar çalıştırılabilir.

### Ne yapar

1. Node sürümünü doğrular
2. `vgantt` adında, kabuğu olmayan bir servis kullanıcısı açar
3. Kodu `/opt/vgantt` dizinine kopyalar (`node_modules`, `.env`, `.git` hariç)
4. `/etc/vgantt/api.env` dosyasını `root:vgantt 0640` izinleriyle oluşturur
5. Bağımlılıkları kurar, API'yi derler, geliştirme bağımlılıklarını temizler
6. `--with-db` verilmişse göçleri uygular (bunun için `postgres` süper kullanıcısına geçer)
7. systemd servisini kurar, başlatır ve iki sağlık kontrolü yapar

## Veritabanı rollerinin şifreleri

Göç betiği üç rol oluşturur. Şifreler ayar dosyasından okunur:

```bash
sudo -u postgres VGANTT_DB_APP_PASSWORD='...' VGANTT_DB_PLATFORM_PASSWORD='...' \
  /opt/vgantt/db/migrate.sh --seed
```

`install.sh --with-db` bunu sizin için yapar. Şifreleri sonradan değiştirirseniz
hem `/etc/vgantt/api.env` dosyasını hem de veritabanını güncelleyin:

```sql
ALTER ROLE vgantt_api          WITH PASSWORD '...';
ALTER ROLE vgantt_platform_api WITH PASSWORD '...';
```

## nginx

```bash
sudo cp deploy/nginx-vgantt.conf /etc/nginx/sites-available/vgantt
sudo nano /etc/nginx/sites-available/vgantt        # server_name ve sertifika yolları
sudo ln -s /etc/nginx/sites-available/vgantt /etc/nginx/sites-enabled/
# nginx.conf içindeki http{} bloğuna ekleyin:
#   limit_req_zone $binary_remote_addr zone=vgantt_auth:10m rate=10r/m;
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d panel.ornek.com.tr
```

`CORS_ORIGINS` değerini alan adınızla eşleştirmeyi unutmayın.

## Günlük işlemler

```bash
sudo systemctl status vgantt-api
sudo journalctl -u vgantt-api -f
sudo systemctl restart vgantt-api

curl -s localhost:3000/api/health
curl -s localhost:3000/api/health/vault-policy    # kasa kuralı hâlâ geçerli mi
```

### Güncelleme

```bash
cd /srv/src/claude-blog && git pull
cd vgantt && sudo ./deploy/install.sh --with-db --with-web
```

Yeni göç yoksa `--with-db` zararsızdır; uygulanmış sürümler atlanır.

## Güvenlik notları

- **PostgreSQL'i dışarı açmayın.** `postgresql.conf` içinde
  `listen_addresses = 'localhost'` yeterlidir; API aynı makinededir.
- **API doğrudan dışarı açık değildir.** `HOST=127.0.0.1` ile yalnızca loopback'i
  dinler; dışarıya nginx bakar. Sunucuda güvenlik duvarı varsa 3000 portunu
  kapatın.
- **systemd sıkılaştırması** hazır geliyor: `ProtectSystem=strict`,
  `NoNewPrivileges`, boş `CapabilityBoundingSet`, salt okunur dosya sistemi.
  API diske hiçbir şey yazmaz - kasa dosyası zaten kullanıcının kendi
  makinesindedir, sunucuda değil.
- **`/etc/vgantt/api.env` dosyasını yedeklemeyin veya depoya koymayın.**
  `root:vgantt 0640` izinleriyle durur.
- **`JWT_SECRET` en az 32 karakter** olmalıdır; kısa olursa API üretim modunda
  açılışta hata verip durur (sessizce zayıf bir anahtarla çalışmaz).
- **Demo veriyi üretime yüklemeyin.** `migrate.sh --demo` yalnızca geliştirme
  içindir; içinde zayıf şifreli hazır hesaplar vardır.

## Sorun giderme

| Belirti | Olası sebep |
|---|---|
| `JWT_SECRET must be at least 32 characters` | Ayar dosyasındaki `__DEGISTIRIN__` alanları dolmamış |
| `password authentication failed for user "vgantt_api"` | `api.env` içindeki şifre ile roldeki şifre farklı; `ALTER ROLE` ile eşitleyin |
| `permission denied for schema app` | Göçler uygulanmamış; `install.sh --with-db` çalıştırın |
| Servis başlıyor, `/health` 502 | nginx `proxy_pass` portu ile `PORT` uyuşmuyor |
| Uyarılar üretilmiyor | `ALERTS_ENABLED=true` mi? `journalctl -u vgantt-api | grep Maintenance` |
| `/health/vault-policy` `compliant:false` | Biri veritabanına kimlik bilgisi kolonu eklemiş; `docs/SECURITY-VAULT.md` |
