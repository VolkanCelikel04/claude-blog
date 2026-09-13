# Modül C - Yerel Şifre Kasası: Teknik Çözüm

Vgantt Suite

## Kural

> Bu modüldeki hiçbir veri (şifreler, kullanıcı adları vb.) **asla** PostgreSQL
> veritabanına veya sunucuya gönderilmez. Bilgiler kullanıcının kendi
> bilgisayarında, `C:/Rsdw` dizini altında bir `.xlsx` dosyasında saklanır.

Bu belge kuralın **nasıl uygulandığını** anlatır. Kural bir sözleşme değil,
dört ayrı katmanda zorlanan bir kısıttır: biri unutulsa diğerleri tutar.

---

## Neden tarayıcı tek başına yetmez

Bir web sayfası `C:/Rsdw/vault.xlsx` dosyasına yazamaz. Tarayıcı, sayfanın
mutlak bir dosya yoluna erişmesine tasarım gereği izin vermez; File System
Access API bile kullanıcıya klasörü **seçtirir**, yolu koda vermez.

Bu yüzden kasa, **Electron masaüstü kabuğunun ana sürecinde (main process)**
çalışır. Ana süreç gerçek bir Node ortamıdır: `C:/Rsdw` klasörünü oluşturur,
dosyayı açar, satır bazlı okur ve yazar.

| Dağıtım | Kasa nerede çalışır | Dosya yolu |
|---|---|---|
| **Electron (önerilen)** | main process | Platform standardı (aşağıdaki tablo) |
| Saf tarayıcı (yedek) | sayfa içi, File System Access API | Kullanıcının bir kez seçtiği klasör |

Arayüz (React) her iki durumda da aynıdır; yalnızca depolama adaptörü değişir.
Saf tarayıcı yedeği için `packages/vault-core/src/adapters/file-system-access.adapter.ts`
hazırdır, ancak ZIP katmanı `node:zlib` kullandığından tarayıcı derlemesinde
`CompressionStream('deflate-raw')` ile değiştirilmesi gerekir. Garanti her iki
durumda aynıdır: baytlar makineden çıkmaz.

---

## Dosya nerede durur

Buradaki asıl kısıt "hangi klasör gelenekseldir" değil, **"hangi klasör sessizce
buluta yüklenmez"**. Her platformun, varsayılan olarak dosyayı cihazdan dışarı
kopyalayan bir yedekleme servisi var - ve bu, modülün tek kuralını çiğner.

| Platform | Konum | Neden | Zorunlu ek adım |
|---|---|---|---|
| **Windows** | `C:\Rsdw\vault.xlsx` | Sürücü kökü, kullanıcı profilinin dışında. OneDrive "Bilinen Klasör Taşıma" Masaüstü, Belgeler ve Resimler'i buluta yönlendirir; `C:\Rsdw` bu kümede değil. | yok |
| **macOS** | `~/Library/Application Support/Rsdw/vault.xlsx` | Apple'ın uygulama verisi için belgelediği yer. **`~/Documents` bilinçli olarak kullanılmıyor**: yeni bir Mac'te varsayılan açık olan iCloud Drive "Masaüstü ve Belgeler" eşitlemesi oradaki her şeyi Apple'a yükler. Application Support iCloud Drive kapsamı dışındadır. | yok |
| **Linux** | `$XDG_DATA_HOME/Rsdw/vault.xlsx` (varsayılan `~/.local/share/Rsdw`) | XDG Base Directory: kullanıcı **verisi**, ayar veya önbellek değil. Önbellek dizini sistem tarafından istenildiği an silinebilir. | yok |
| **iOS** | `<app container>/Library/Application Support/Rsdw/vault.xlsx` | Uygulama sandbox'ı. `Documents/` Dosyalar uygulamasında görünür ama iCloud'a yedeklenir - Application Support da öyle. `Library/Caches` yedeklenmez ama iOS depolama sıkışınca silebilir; bir kasa için kabul edilemez. | `isExcludedFromBackupKey = true` (dizin oluşturulur oluşturulmaz) |
| **Android** | `Context.getFilesDir()/Rsdw/vault.xlsx` | Uygulamaya özel iç depolama: root olmadan başka uygulamalar okuyamaz. **`getExternalFilesDir()` değil** - o paylaşılan depolamada durur. | `android:allowBackup="false"` veya `dataExtractionRules` ile `files/Rsdw` hariç tutulmalı (Android 6+ Auto Backup varsayılan olarak Google Drive'a kopyalar) |

Klasör adı her platformda aynı: **`Rsdw`**. Kullanıcı cihaz değiştirdiğinde ne
arayacağını bilir, destek ekibi tek bir ad sorar.

### Tek kaynak: `vault-location.ts`

Bu tablo dokümantasyon değil, **çalışan kod**:

```ts
import { resolveVaultPath, backupExclusionFor } from '@vgantt/vault-core';

resolveVaultPath({ platform: 'win32' });
// 'C:/Rsdw/vault.xlsx'

resolveVaultPath({ platform: 'darwin', env: { HOME: '/Users/volkan' } });
// '/Users/volkan/Library/Application Support/Rsdw/vault.xlsx'

// Sandbox'lı platformlar yolu tahmin etmez; konteyneri host verir.
resolveVaultPath({ platform: 'android', baseDirectory: filesDir });
// '<filesDir>/Rsdw/vault.xlsx'

backupExclusionFor('ios');
// 'Set URLResourceKey.isExcludedFromBackupKey = true ...'
```

iOS ve Android için `baseDirectory` verilmezse fonksiyon **hata fırlatır**.
Sandbox yolunu tahmin etmek, uygulamanın yazamayacağı bir dosya üretirdi;
sessizce yanlış yere yazmaktansa açıkça durması daha iyi.

Kullanıcı kendi yolunu seçebilir (`VGANTT_VAULT_DIR` veya uygulama ayarı) -
kasasını şifreli bir bölümde ya da çıkarılabilir diskte tutmak isteyen için
meşru bir tercih.

### Mobil kabuklar için not

`vault-core` bir Node paketidir (ZIP katmanı `node:zlib` kullanır), yani iOS ve
Android'de doğrudan çalışmaz. Bu platformlar için tablodaki satırlar bir
**sözleşmedir**: yerel uygulama kendi dilinde aynı dizini, aynı klasör adını ve
aynı yedekleme dışlamasını uygular. `VAULT_LOCATIONS` tablosu bu sözleşmenin
tek kaynağı olduğu için masaüstü ve mobil kabuklar zamanla birbirinden
ayrışamaz.

---

## Mimari

```
┌──────────────────── Electron uygulaması ────────────────────┐
│                                                             │
│  Renderer (React)              Main process (Node)          │
│  ┌──────────────────┐          ┌────────────────────────┐   │
│  │ VaultPage.tsx    │          │ vault-ipc.ts           │   │
│  │  - liste (şifre  │  IPC     │  - Vault örneği        │   │
│  │    ALANI YOK)    │ ───────► │  - ana şifre burada    │   │
│  │  - "Göster"      │          │  - türetilmiş anahtar  │   │
│  │  - "Kopyala"     │ ◄─────── │    burada              │   │
│  └──────────────────┘          └───────────┬────────────┘   │
│         ▲                                  │                │
│         │ contextBridge (preload.cts)      │ node:fs        │
│         │ sabit kanal listesi              ▼                │
│         │                       C:/Rsdw/vault.xlsx          │
└─────────┼───────────────────────────────────────────────────┘
          │
          └──► API'ye giden TEK şey: { deviceLabel, vaultPath, entryCount }
```

**Renderer'ın yapamadıkları**, tasarım gereği:

- dosyayı okumak (dosya sistemine erişimi yok, `sandbox: true`)
- ana şifreyi geri almak (yalnızca `unlock` çağrısında bir kez gönderir)
- türetilmiş anahtarı görmek (hiç dışarı verilmez)
- bütün şifreleri toplu istemek (`list` şifre alanını döndürmez)

`preload.cts` genel bir `invoke(channel)` açmaz; kanallar tek tek sayılıdır.
Arayüzde tam bir XSS bile kasa dosyasını okuyamaz - yalnızca zaten açık bir
kasadan, kullanıcının açıkça istediği tek bir şifreyi sorabilir.

---

## Dosya biçimi

`C:/Rsdw/vault.xlsx` gerçek bir Excel çalışma kitabıdır. Kullanıcı çift
tıklayıp açabilir, satırlarını görebilir.

**Sayfa `Kasa`**

| ID | Başlık | Kategori | Adres | Kullanıcı Adı | Şifre | Notlar | Etiketler | Oluşturulma | Güncelleme |
|----|--------|----------|-------|---------------|-------|--------|-----------|-------------|------------|
| uuid | Şirket e-postası | E-posta | outlook.office.com | `enc:v1:…` | `enc:v1:…` | `enc:v1:…` | ofis, kritik | ISO tarih | ISO tarih |

**Sayfa `_vgantt_meta`** - şema sürümü, KDF parametreleri, tuz ve doğrulayıcı.

Başlık, kategori ve adres sütunları **okunabilir kalır**; dosya Excel'de
anlamlıdır. Kullanıcı adı, şifre ve notlar şifrelenir.

### Şifreleme neden var

Brief "Excel dosyasında saklanacak" diyor, "düz metin" demiyor. Düz metin
bir kasa, dosyayı kopyalayan herkese her şeyi verir - USB'ye alınan, yedeklenen,
OneDrive'a senkronlanan bir dosya. Şifreleme kuralı ihlal etmez, aynı dosyada
kalır; yalnızca dosyayı tek başına değersiz kılar.

| Öğe | Seçim | Gerekçe |
|---|---|---|
| Anahtar türetme | PBKDF2-HMAC-SHA256, 600.000 tur | OWASP 2023 önerisi; hem Node hem WebCrypto'da var, dosya her iki ortamda açılır |
| Şifreleme | AES-256-GCM, 96-bit rastgele IV | Kimlik doğrulamalı şifreleme: değiştirilmiş hücre sessizce çözülmez |
| AAD | `"<kayıt-id>:<alan>"` | Bir hücrenin şifreli metni başka satıra kopyalanırsa çözülemez |
| Kütüphane | Yok - yalnızca WebCrypto | Düz metin şifrelere dokunan üçüncü parti kod yüzeyi sıfır |

Şifrelemeyi kapatmak mümkündür (`encrypt: false`) ama arayüzde açıkça
"şifresiz (önerilmez)" olarak gösterilir.

---

## Dosya güvenliği

- **Atomik yazma:** önce `vault.xlsx.tmp-<pid>-<ts>`, sonra `rename()`. Yazma
  sırasında elektrik kesilirse eski dosya bozulmaz.
- **Otomatik yedek:** her kaydetmede önceki sürüm `vault.xlsx.bak` olur.
- **Dosya izinleri:** dosya `0600`, klasör `0700` ile oluşturulur.
- **Otomatik kilit:** 10 dakika işlem yapılmazsa kasa bellekten düşer.
- **Pano temizliği:** kopyalanan şifre 30 saniye sonra panodan silinir.

---

## Sunucu tarafındaki sınır

Sunucunun kasa hakkında bildiği **tek şey** şudur:

```jsonc
// PUT /api/vault/workstations
{ "deviceLabel": "VOLKAN-PC", "vaultPath": "C:/Rsdw/vault.xlsx", "entryCount": 42 }
```

Makine etiketi, dosya yolu ve kayıt **sayısı**. Amaç destek sorusudur:
"kasam hangi makinede?". Kayıt sayısı bir sırrı taşımaz.

Bu sınır üç yerde birden zorlanır:

1. **DTO** (`vault.dto.ts`) - şifre koyulabilecek bir alan yoktur, ve global
   `ValidationPipe` `forbidNonWhitelisted: true` ile fazladan alanları reddeder.
2. **Guard** (`NoSecretPayloadGuard`) - istek gövdesini tarar; `password`,
   `secret`, `entries`, `ciphertext` benzeri bir anahtar görürse isteği
   **400 VAULT_BOUNDARY_VIOLATION** ile reddeder ve hata seviyesinde loglar.
3. **Veritabanı** (`0008_module_vault_guard.sql`) - bir event trigger,
   `app`/`platform`/`audit` şemalarında kimlik bilgisi biçiminde bir **kolon
   açılmasını** engeller. Göç bile olsa reddedilir:

```
ERROR:  VAULT POLICY VIOLATION: column app.sifre_kasasi.password
        looks like stored credential material
HINT:   Keep the value in the local C:/Rsdw vault file...
```

Kural yalnızca ada değil **tipe** de bakar: `must_change_password` (boolean)
serbesttir, `password` (text) değildir. İncelemeden geçmiş tek yönlü özetler
(`app.users.password_hash`) `platform.secret_column_allowlist` tablosunda
açıkça listelenir.

Canlı sistemde kuralın hâlâ geçerli olduğunu doğrulamak için:

```bash
curl -s http://localhost:3000/api/health/vault-policy
# {"compliant":true,"violations":[], ...}
```

---

## Testlerle kanıt

`packages/vault-core/test/` (24 test, `npm run test:vault`):

- dosya yoksa oluşturulur, varsa açılır - üzerine yazılmaz
- satır bazlı ekleme/güncelleme/silme kaydet-yeniden aç döngüsünden sağ çıkar
- **şifreler dosyanın içinde okunamaz** - ZIP açılıp tüm XML parçaları
  taranarak doğrulanır (ham baytta aramak sıkıştırma yüzünden yanıltıcıdır)
- yanlış ana şifre reddedilir, sessizce yanlış çözülmez
- bir hücrenin şifreli metni başka satıra taşınırsa çözülmez (AAD bağlama)
- ana şifre değişiminde tuz döner ve eski şifre artık açmaz
- **kaynak dosyalarının hiçbirinde `fetch`, `XMLHttpRequest`, `WebSocket`,
  `node:net`, `node:http` yoktur** - mekanik olarak taranır
- gerçek dosya sisteminde atomik yazma, `.bak` yedeği, artık `.tmp` dosyası yok
- her platformun doğru dizine çözümlenmesi, macOS'ta `~/Documents`'a **düşmemesi**,
  sandbox'lı platformların yolu tahmin etmeyi reddetmesi

Son maddeden önceki test, "sunucuya gitmiyor" iddiasını bir yorum satırı
olmaktan çıkarıp derlemede kontrol edilen bir özelliğe dönüştürür.

---

## Kurtarma

Ana şifre unutulursa kasa içeriği **kurtarılamaz**. Bu, tasarımın sonucudur:
anahtar yalnızca kullanıcının şifresinden türetilir ve hiçbir yerde saklanmaz.
Arayüz bunu kasa oluşturulurken açıkça söyler.

Dosya bozulursa `vault.xlsx.bak` ile `vault-<tarih>.xlsx` yedekleri denenir.
