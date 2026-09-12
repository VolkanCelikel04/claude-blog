# Veritabanı

PostgreSQL 16. Üç şema, tek veritabanı.

| Şema | İçerik | Kim yazar |
|---|---|---|
| `platform` | Tenant'lar, abonelikler, modül lisansları, planlar, faturalar, operatörler | Yalnızca VganttAdmin |
| `app` | Tenant iş verisi - her tabloda `tenant_id`, RLS zorunlu | Tenant kullanıcıları |
| `audit` | Yalnızca eklenebilir işlem geçmişi | Her ikisi (ekleme) |

## Göç sırası

```bash
db/migrate.sh --reset --demo     # sıfırdan kur + demo veri
db/migrate.sh --seed             # yalnızca referans veri
db/tests/run.sh                  # izolasyon + guard + uyarı testleri
```

| Dosya | İçerik |
|---|---|
| `0001_bootstrap.sql` | Eklentiler, şemalar, roller, `set_tenant_context`, `apply_tenant_rls` |
| `0002_platform_core.sql` | `tenants`, `tenant_contacts`, `admin_users`, `audit.activity_log` |
| `0003_platform_billing.sql` | `modules`, `plans`, `subscriptions`, `tenant_modules`, `invoices`, `payments`, `tenant_has_module` |
| `0004_identity_rbac.sql` | `users`, `roles`, `permissions`, `user_roles`, `refresh_tokens`, `v_user_permissions` |
| `0005_notifications.sql` | Bildirim tabloları, `alert_sources`, `alert_policies`, uyarı motoru |
| `0006_module_licenses.sql` | **Modül A** - lisans/süre takibi |
| `0007_module_finance.sql` | **Modül B** - gider, alacak, tahsilat, raporlama view'ları |
| `0008_module_vault_guard.sql` | **Modül C** - tablo yok; kimlik bilgisi kolonu yasağı |
| `0009_platform_views.sql` | Admin panosu view'ları, `run_daily_maintenance` |
| `0010_grants.sql` | Sahiplik devri ve nihai yetki yüzeyi |

Göçler idempotenttir: uygulanan sürüm `platform.schema_migrations` tablosunda
tutulur, `migrate.sh` uygulanmışları atlar.

## İzolasyonun anatomisi

Her tenant tablosu tek bir çağrıyla modele bağlanır:

```sql
SELECT app.apply_tenant_rls('app.licenses', 'licenses');
--                            tablo          modül anahtarı (opsiyonel)
```

Bu çağrı şunları yapar:

1. `ENABLE` + `FORCE ROW LEVEL SECURITY` (tablo sahibi de kapsanır)
2. `tenant_isolation` politikası: `tenant_id = app.current_tenant_id()`
   - modül anahtarı verildiyse `AND app.tenant_has_module(tenant_id, '...')`
3. `BEFORE INSERT/UPDATE` trigger'ı: `tenant_id` damgalar, çapraz yazmayı reddeder
4. `updated_at` trigger'ı (kolon varsa)
5. `vgantt_api` ve `vgantt_platform_api` için `GRANT`

`tenant_id` kolonu olmayan bir tabloda çağrı **hata verir**. İzolasyon dışında
kalan bir tenant tablosu sessizce oluşamaz.

## View'lar ve `security_invoker`

`app` şemasındaki tüm view'lar `WITH (security_invoker = true)` ile oluşturulur.
Varsayılan davranışta RLS, view'ı **sahibinin** haklarıyla değerlendirir; bu
durumda tenant süzmesi çalışmaz. `security_invoker` ile politika çağıranın
kimliğine göre uygulanır.

## Türetilmiş durum saklanmaz

- Lisans `days_remaining` değeri kolonda tutulmaz, `app.v_license_expiry`
  view'ında hesaplanır - gece yarısı bayatlayamaz.
- Fatura durumu ve `paid_amount` elle yazılmaz; `app.customer_payments`
  üzerindeki trigger defterden yeniden hesaplar. Kısmi ödeme, iade ve gecikme
  taraması birbiriyle çelişemez.
- Abonelik dönemleri `EXCLUDE USING gist` ile çakışamaz; "hangi lisans geçerli"
  sorusunun tek yanıtı olur.

## Kimlik bilgisi kolonu yasağı

`0008` bir event trigger kurar. `app`, `platform`, `audit` ve `public`
şemalarında adı kimlik bilgisi biçiminde **ve** tipi metin/ikili olan bir kolon
açılmaya çalışılırsa `CREATE TABLE` / `ALTER TABLE` reddedilir.

İstisnalar `platform.secret_column_allowlist` tablosunda açıkça listelenir
(yalnızca tek yönlü özetler). Kural, event trigger kurulamayan yönetilen
PostgreSQL servislerinde `platform.check_no_secret_columns()` fonksiyonuyla
CI'dan doğrulanır.

Ayrıntı: `docs/SECURITY-VAULT.md`.

## Fonksiyon yetkileri

PostgreSQL her yeni fonksiyona **PUBLIC için EXECUTE** verir. Sıradan
fonksiyonlarda bu zararsızdır; buradaki `SECURITY DEFINER` yardımcılarında
değildir. `app.emit_notification()` argüman olarak `tenant_id` alır ve sahibinin
haklarıyla çalışır - PUBLIC yetkisi kalsaydı bir kiracı başka bir kiracının
bildirim kutusuna kayıt yazabilirdi.

`0010_grants.sql` bu yüzden önce `app`, `platform` ve `audit` şemalarındaki tüm
fonksiyonlardan PUBLIC yetkisini toplu olarak geri alır, sonra tenant rolüne
yalnızca şu listeyi verir:

```
app.set_tenant_context, app.current_tenant_id, app.current_user_id,
app.tenant_has_module, app.severity_for_days,
app.generate_my_expense_occurrences, platform.thresholds_for,
platform.check_no_secret_columns
```

Uyarı üreticileri, bakım rutinleri ve kiracılar arası çalışan toplu üreticiler
yalnızca platform havuzundan erişilebilir. `ALTER DEFAULT PRIVILEGES ... REVOKE
EXECUTE ... FROM PUBLIC` satırı, ileride eklenecek modül fonksiyonlarının bu
kuralı otomatik devralmasını sağlar - aksi halde her yeni modül deliği sessizce
yeniden açardı.

Bu kural `db/tests/isolation_test.sql` bölüm 6b'de test edilir.

## Test kapsamı

`db/tests/isolation_test.sql` - `vgantt_api` rolüyle çalışır, 29 iddia:

- bağlam yokken 0 satır (fail-closed)
- yalnızca kendi tenant'ının satırları
- çapraz tenant `INSERT`/`UPDATE` reddi
- `tenant_id` otomatik damgalama
- kapalı modülde okuma **ve** yazma engeli
- kontrol düzlemi tablolarına erişememe, kendi kendine modül açamama
- `COMMIT` sonrası bağlamın kaybolması (havuzlanmış bağlantı güvenliği)
- view'ların çağırana göre süzülmesi
- SECURITY DEFINER yardımcı fonksiyonlarının tenant rolüne kapalı olması

`db/tests/guard_and_alerts_test.sql` - süper kullanıcıyla, 20 iddia:
kimlik bilgisi kolonu reddi, 30/15/7/3 merdiveninin tam günlerde ateşlenmesi,
idempotentlik, alacak risk kovaları, admin panosu kovaları.
