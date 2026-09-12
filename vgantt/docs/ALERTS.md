# Uyarı ve Bildirim Motoru

## Gereksinim

Lisans veya abonelik bitimine **30, 15, 7 ve 3 gün kala** otomatik uyarı;
müşteri alacaklarında vadeye **3 gün kala** hatırlatma.

## Tasarım

Motor, neyin süresinin dolduğunu bilmez. `platform.alert_sources` tablosunu
gezer ve her kaynağın kaydettiği üretici fonksiyonu çağırır:

```sql
SELECT source_type, module_key, generator, default_thresholds
FROM platform.alert_sources WHERE is_active;
```

| source_type | modül | eşikler | üretici |
|---|---|---|---|
| `subscription` | - | 30, 15, 7, 3 | `platform.generate_subscription_alerts` |
| `module_license` | - | 30, 15, 7, 3 | `platform.generate_module_license_alerts` |
| `license` | licenses | 30, 15, 7, 3 | `app.generate_license_alerts` |
| `receivable` | finance | 3 (+ gecikme) | `app.generate_receivable_alerts` |
| `recurring_expense` | finance | 7, 3 | `app.generate_expense_alerts` |

Yeni bir modül tabloya bir satır ekleyerek merdiveni devralır. Motor kodu
değişmez.

## Eşikler tenant bazında değiştirilebilir

```sql
INSERT INTO platform.alert_policies (tenant_id, source_type, thresholds, channels)
VALUES ('<tenant>', 'license', ARRAY[60, 30, 7], ARRAY['in_app', 'email']);
```

Öncelik: tenant kaydı → global kayıt → kaynağın varsayılanı.

## Aynı uyarı iki kez üretilmez

Her bildirimin bir `dedupe_key` değeri vardır:

```
license:<uuid>:2026-03-14:30
kaynak   kayıt    vade      eşik
```

`UNIQUE (tenant_id, dedupe_key)` sayesinde motor günde on kez çalışsa da
gelen kutusu şişmez. Vade **değiştiğinde** anahtar da değişir, bu yüzden bir
lisans yenilendiğinde yeni dönem için merdiven baştan başlar - eski uyarılar
geçmişte kalır.

Test edilmiştir: motor üç kez üst üste çalıştırıldığında 0 yeni kayıt üretir
(`db/tests/guard_and_alerts_test.sql`, bölüm C).

## Önem seviyesi

| Kalan gün | Seviye | Arayüz |
|---|---|---|
| 30, 15 | `info` / `warning` | Bilgi şeridi |
| 7 | `warning` | Sarı rozet |
| 3, 0 | `critical` | Kırmızı rozet + kenar çubuğunda sayaç |
| negatif | `critical` | "N gün gecikti" |

Rozetler her zaman metin taşır ("3 gün kaldı", "15 gün gecikti"); durum hiçbir
zaman yalnızca renkle anlatılmaz.

## Çalışma zamanı

```
ALERTS_CRON=0 6 * * *     # her sabah 06:00
```

`AlertsScheduler` bu ifadeyi konfigürasyondan okur ve
`platform.run_daily_maintenance()` çağırır. O da sırasıyla:

1. süresi dolan abonelikleri `expired` yapar
2. aboneliksiz kalan tenant'ları `suspended` yapar
3. süresi geçen lisansları `expired`, faturaları `overdue` işaretler
4. düzenli giderlerin önümüzdeki 90 günlük taksitlerini üretir
5. uyarı motorunu çalıştırır
6. e-posta/webhook kanallarına dağıtır

Birden fazla API örneği aynı anda çalışsa da üreticiler idempotent olduğundan
ikinci çalıştırma hiçbir şey üretmez.

## Elle çalıştırma

```bash
# VganttAdmin oturumuyla
curl -X POST /api/admin/alerts/maintenance
curl -X POST "/api/admin/alerts/run?asOf=2026-04-01"   # belirli bir güne göre
```

`asOf` parametresi, merdivenin doğru günlerde ateşlendiğini test etmeyi
mümkün kılar - test paketi sanal bir takvimi 40 günden geriye sayarak tam
olarak `{30, 15, 7, 3, 0}` günlerinde bildirim üretildiğini doğrular.

## Dağıtım kanalları

`MAIL_TRANSPORT=console|smtp|webhook`. Bildirim önce veritabanına yazılır,
sonra dağıtılır; kanal başarısız olursa `delivered_at` boş kalır ve bir sonraki
çalıştırma yeniden dener. Uygulama içi bildirimler kanal gerektirmez - onlar
zaten arayüzün okuduğu satırlardır.
