# macOS'ta Geliştirme

Apple Silicon ve Intel Mac'lerde aynı adımlar.

## 1. Kodu alın

```bash
git clone https://github.com/VolkanCelikel04/claude-blog.git
cd claude-blog
git checkout claude/multi-tenant-saas-architecture-wb32ds
cd vgantt
```

Depo adı `claude-blog`; proje bu deponun `vgantt/` klasöründe. Dal adı:
`claude/multi-tenant-saas-architecture-wb32ds`.

## 2. Gereksinimler

```bash
# Homebrew yoksa: https://brew.sh
brew install node@22 postgresql@16

# Node 22'yi PATH'e alın (Apple Silicon yolu; Intel'de /usr/local)
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zshrc
echo 'export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

node -v     # v22.x olmalı
psql --version

brew services start postgresql@16
```

> Node sürüm yöneticisi kullanıyorsanız (`nvm`, `fnm`, `mise`) `node@22` yerine
> onu kullanın; proje Node **22.6+** istiyor - yerel kasa testleri Node'un
> yerleşik TypeScript tip-sıyırma özelliğiyle çalışıyor.

Homebrew PostgreSQL'de süper kullanıcı, macOS kullanıcı adınızdır (`postgres`
diye ayrı bir kullanıcı yoktur). Göç betiği bunu varsayar, ekstra bir şey
yapmanız gerekmez.

## 3. Veritabanı

```bash
db/migrate.sh --reset --demo
db/tests/run.sh
```

`run.sh` çıktısının sonunda `ALL ISOLATION TESTS PASSED` ve
`ALL GUARD + ALERT TESTS PASSED` görmelisiniz.

### Yerel (locale) notu

Linux'taki `C.UTF-8` yereli macOS'ta yoktur. `migrate.sh` bunu kendisi
hallediyor: önce tercih edilen yereli dener, yoksa kümenin kendi varsayılanına
düşer ve bunu ekrana yazar. Türkçe sıralama önemliyse ICU kullanın:

```bash
VGANTT_DB_LOCALE=icu:tr-TR db/migrate.sh --reset --demo
```

## 4. API ve arayüz

```bash
npm install

cp apps/api/.env.example apps/api/.env
# JWT_SECRET'i doldurun:  openssl rand -base64 48

npm run dev:api     # http://localhost:3000/api/docs
npm run dev:web     # http://localhost:5173
```

İki ayrı terminal sekmesi gerekir.

Demo girişleri:

| Rol | E-posta | Şifre |
|---|---|---|
| VganttAdmin | `admin@vgantt.local` | `12345` |
| Şirket yöneticisi | `admin@acme.example` | `Vgantt2026!` |

## 5. Masaüstü kabuğu (şifre kasası)

```bash
npm run dev:desktop
```

Kasa modülü yalnızca Electron kabuğunda çalışır - tarayıcı mutlak bir dosya
yoluna yazamaz. macOS'ta kasa dosyası şuraya gelir:

```
~/Library/Application Support/Rsdw/vault.xlsx
```

Finder'da `Library` gizlidir; açmak için: **Finder → Git → Klasöre Git**
(`Shift+Cmd+G`) ve yolu yapıştırın.

Bu konum bilinçli seçildi: `~/Documents` kullanılsaydı, yeni Mac'lerde
varsayılan açık olan iCloud Drive "Masaüstü ve Belgeler" eşitlemesi kasayı
Apple'a yüklerdi. Application Support iCloud Drive kapsamı dışındadır.
Ayrıntı: `docs/SECURITY-VAULT.md`.

Başka bir konum denemek için:

```bash
VGANTT_VAULT_DIR=~/Desktop/kasa-deneme npm run dev:desktop
```

## 6. Testler

```bash
db/tests/run.sh        # veritabanı izolasyonu + kasa guard'ı + uyarı merdiveni
npm run test:vault     # yerel kasa: xlsx, şifreleme, konum, ağ yasağı (24 test)
npm run typecheck      # tüm çalışma alanları
```

## Sık karşılaşılanlar

| Belirti | Çözüm |
|---|---|
| `psql: command not found` | `brew services start postgresql@16` ve PATH satırlarını `~/.zshrc`'ye ekleyip `source ~/.zshrc` |
| `role "vgantt_api" does not exist` | `db/migrate.sh --reset --demo` çalıştırılmamış |
| `invalid locale name` | Eski bir kopya; `git pull` ile güncelleyin (yerel geri düşmesi eklendi) |
| `npm error code EBADENGINE` | Node 22.6+ gerekli: `node -v` ile doğrulayın |
| Electron açılıyor ama sayfa boş | `npm run dev:web` ayrı sekmede çalışmıyor |
| Kasa dosyasını Finder'da bulamıyorum | `Shift+Cmd+G` → `~/Library/Application Support/Rsdw` |

## Sunucuya kurulum burada anlatılmıyor

`deploy/install.sh` systemd kullanır ve yalnızca Linux sunucu içindir. Mac
geliştirme makinenizde çalıştırmayın. Sunucu için: `docs/DEPLOYMENT.md`.
