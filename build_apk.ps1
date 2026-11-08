$ErrorActionPreference = 'Stop'

$Root = 'D:\dsh2'
$App = Join-Path $Root 'app\src\main'
$Build = Join-Path $Root 'build\manual'
$Dist = Join-Path $Root 'dist'
$Jdk = Join-Path $Root 'toolchain\jdk\jdk-17.0.21+9'
$Sdk = Join-Path $Root 'toolchain\android'
$BuildTools = Join-Path $Sdk 'build-tools\34.0.0'
$Platform = Join-Path $Sdk 'platforms\android-34-ext12'
$AndroidJar = Join-Path $Platform 'android.jar'
$Aapt2 = Join-Path $BuildTools 'aapt2.exe'
$D8 = Join-Path $BuildTools 'd8.bat'
$ZipAlign = Join-Path $BuildTools 'zipalign.exe'
$ApkSigner = Join-Path $BuildTools 'apksigner.bat'
$Javac = Join-Path $Jdk 'bin\javac.exe'
$Jar = Join-Path $Jdk 'bin\jar.exe'
$Keytool = Join-Path $Jdk 'bin\keytool.exe'

$env:JAVA_HOME = $Jdk
$env:Path = (Join-Path $Jdk 'bin') + ';' + $env:Path

$VersionCode = 19
$VersionName = '1.5.0'
$ApkName = "JieShu-v$VersionName.apk"
$KeystoreDir = Join-Path $Root 'signing'
$Keystore = Join-Path $KeystoreDir 'jieshu-release.jks'
$StorePass = 'JieShu2026Local'
$KeyAlias = 'jieshu'

Write-Host '==> Clean build folders' -ForegroundColor Cyan
if (Test-Path $Build) { Remove-Item $Build -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Build, (Join-Path $Build 'gen'), (Join-Path $Build 'classes'), (Join-Path $Build 'dex'), $Dist, $KeystoreDir | Out-Null

Write-Host '==> Compile Android resources' -ForegroundColor Cyan
& $Aapt2 compile --dir (Join-Path $App 'res') -o (Join-Path $Build 'res.zip')
if ($LASTEXITCODE -ne 0) { throw 'aapt2 compile failed' }

Write-Host '==> Link resources and assets' -ForegroundColor Cyan
& $Aapt2 link `
    -o (Join-Path $Build 'app-unsigned.apk') `
    -I $AndroidJar `
    --manifest (Join-Path $App 'AndroidManifest.xml') `
    -R (Join-Path $Build 'res.zip') `
    -A (Join-Path $App 'assets') `
    --java (Join-Path $Build 'gen') `
    --auto-add-overlay `
    --min-sdk-version 23 `
    --target-sdk-version 34 `
    --version-code $VersionCode `
    --version-name $VersionName
if ($LASTEXITCODE -ne 0) { throw 'aapt2 link failed' }

Write-Host '==> Compile Java' -ForegroundColor Cyan
$javaSources = @()
$javaSources += (Get-ChildItem (Join-Path $App 'java') -Recurse -Filter '*.java').FullName
$javaSources += (Get-ChildItem (Join-Path $Build 'gen') -Recurse -Filter '*.java').FullName
& $Javac -encoding UTF-8 -source 8 -target 8 -Xlint:-options -bootclasspath $AndroidJar -classpath $AndroidJar -d (Join-Path $Build 'classes') $javaSources
if ($LASTEXITCODE -ne 0) { throw 'javac failed' }

Write-Host '==> Dex with d8' -ForegroundColor Cyan
& $Jar cf (Join-Path $Build 'classes.jar') -C (Join-Path $Build 'classes') .
if ($LASTEXITCODE -ne 0) { throw 'jar failed' }
& $D8 --release --lib $AndroidJar --min-api 23 --output (Join-Path $Build 'dex') (Join-Path $Build 'classes.jar')
if ($LASTEXITCODE -ne 0) { throw 'd8 failed' }

Write-Host '==> Add classes.dex to APK' -ForegroundColor Cyan
@"
import zipfile
apk = r'$($Build)\app-unsigned.apk'
dex = r'$($Build)\dex\classes.dex'
with zipfile.ZipFile(apk, 'a', zipfile.ZIP_DEFLATED) as z:
    z.write(dex, 'classes.dex')
print('classes.dex added')
"@ | & 'D:\Python312\python.exe' -
if ($LASTEXITCODE -ne 0) { throw 'adding classes.dex failed' }

Write-Host '==> Align APK' -ForegroundColor Cyan
& $ZipAlign -f -p 4 (Join-Path $Build 'app-unsigned.apk') (Join-Path $Build 'app-aligned.apk')
if ($LASTEXITCODE -ne 0) { throw 'zipalign failed' }

if (-not (Test-Path $Keystore)) {
    Write-Host '==> Create release keystore' -ForegroundColor Cyan
    & $Keytool -genkeypair -v `
        -keystore $Keystore `
        -alias $KeyAlias `
        -keyalg RSA `
        -keysize 2048 `
        -validity 10000 `
        -storepass $StorePass `
        -keypass $StorePass `
        -dname 'CN=JieShu, OU=Studio, O=JieShu, L=Shanghai, ST=Shanghai, C=CN' `
        -noprompt
    if ($LASTEXITCODE -ne 0) { throw 'keytool failed' }
}

Write-Host '==> Sign APK' -ForegroundColor Cyan
$finalApk = Join-Path $Dist $ApkName
if (Test-Path $finalApk) { Remove-Item $finalApk -Force }
& $ApkSigner sign `
    --ks $Keystore `
    --ks-key-alias $KeyAlias `
    --ks-pass "pass:$StorePass" `
    --key-pass "pass:$StorePass" `
    --out $finalApk `
    (Join-Path $Build 'app-aligned.apk')
if ($LASTEXITCODE -ne 0) { throw 'apksigner failed' }

Write-Host '==> Verify APK' -ForegroundColor Cyan
& $ApkSigner verify --verbose --print-certs $finalApk
if ($LASTEXITCODE -ne 0) { throw 'signature verification failed' }
$badging = & $Aapt2 dump badging $finalApk
$badging | Select-Object -First 8

$size = [math]::Round((Get-Item $finalApk).Length / 1MB, 2)
Write-Host "==> Done: $finalApk ($size MB)" -ForegroundColor Green
exit 0
