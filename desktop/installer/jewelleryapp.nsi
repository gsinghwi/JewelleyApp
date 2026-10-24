; JewelleryApp installer (NSIS 3). Built by desktop/build.sh:
;   makensis -DVERSION=1.0.0 -DDIST=<folder with the built files> jewelleryapp.nsi
;
; Installs the programs in Program Files, keeps the data in a folder you choose
; (default C:\ProgramData\JewelleryApp), registers the "JewelleryApp Database" Windows service
; (starts automatically with Windows, stopped cleanly at shutdown), opens port 8090 in the Windows
; firewall for private networks (so other laptops on the shop Wi-Fi can use the app in their
; browser) and adds shortcuts.
; Uninstalling removes the programs and the service but KEEPS the data and backups.

Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!ifndef DIST
  !define DIST "..\build\dist"
!endif

!define APP "JewelleryApp"
!define SERVICE "JewelleryAppDB"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP}"

Name "${APP} ${VERSION}"
OutFile "${DIST}\..\JewelleryApp-Setup-${VERSION}.exe"
InstallDir "$PROGRAMFILES64\${APP}"
InstallDirRegKey HKLM "Software\${APP}" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
BrandingText "${APP} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP}"
VIAddVersionKey "FileDescription" "${APP} setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Nisarg Jewellers"

Var DataDir

!define MUI_ICON "jewelleryapp.ico"
!define MUI_UNICON "jewelleryapp.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Install ${APP} ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "This installs the JewelleryApp billing, stock, CRM and pawn software and its database on this laptop.$\r$\n$\r$\nJewelleryApp is used in a web browser (Chrome or Edge): on this laptop at http://localhost:8090, and on other laptops on the same Wi-Fi at http://<this laptop's IP>:8090.$\r$\n$\r$\nThe database starts by itself with the laptop and stops safely at shutdown. A backup is taken every day.$\r$\n$\r$\nFirst sign in: username admin, password admin123 (you will be asked to change it)."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY

; second folder page: where the database is kept
!define MUI_PAGE_HEADER_TEXT "Data folder"
!define MUI_PAGE_HEADER_SUBTEXT "Choose where the JewelleryApp database is stored."
!define MUI_DIRECTORYPAGE_TEXT_TOP "The database, logs and (by default) daily backups are kept in this folder. Keep it on a local drive. It is NOT removed if you uninstall."
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION "Data folder"
!define MUI_DIRECTORYPAGE_VARIABLE $DataDir
!insertmacro MUI_PAGE_DIRECTORY

!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\JewelleryApp.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open JewelleryApp in the browser now"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\docs\MASTER-DATA.html"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Show the master data setup guide"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "JewelleryApp needs 64-bit Windows 10 or 11."
    Abort
  ${EndIf}
  SetRegView 64
  ReadRegStr $DataDir HKLM "Software\${APP}" "DataDir"
  ${If} $DataDir == ""
    StrCpy $DataDir "$COMMONPROGRAMDATA\${APP}"
  ${EndIf}
FunctionEnd

Section "JewelleryApp" SecMain
  SectionIn RO
  SetShellVarContext all
  SetRegView 64

  ; upgrading: stop the running database before replacing the program
  IfFileExists "$INSTDIR\jewellery-server.exe" 0 +3
    DetailPrint "Stopping the running JewelleryApp database..."
    nsExec::ExecToLog '"$INSTDIR\jewellery-server.exe" service stop'
  Sleep 2000

  SetOutPath "$INSTDIR"
  File "${DIST}\jewellery-server.exe"
  File "${DIST}\JewelleryApp.exe"
  File "jewelleryapp.ico"
  SetOutPath "$INSTDIR\docs"
  File /r "${DIST}\docs\*.*"
  SetOutPath "$INSTDIR"

  CreateDirectory "$DataDir"
  CreateDirectory "$DataDir\backups"
  ; jewellery.json: data folder and address (all network cards: this laptop and the shop Wi-Fi)
  nsExec::ExecToLog '"$INSTDIR\jewellery-server.exe" config --data-dir "$DataDir\pb_data" --http 0.0.0.0:8090'

  ; let other devices on PRIVATE (home / work) networks reach port 8090; public Wi-Fi stays blocked
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="JewelleryApp"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="JewelleryApp" description="JewelleryApp in the browser on the shop network" dir=in action=allow protocol=TCP localport=8090 profile=private,domain'

  DetailPrint "Registering the JewelleryApp Database service..."
  nsExec::ExecToLog '"$INSTDIR\jewellery-server.exe" service install'
  DetailPrint "Starting the database..."
  nsExec::ExecToLog '"$INSTDIR\jewellery-server.exe" service start'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "The database service did not start. Restart the laptop, or see $DataDir\logs\server.log."
  ${EndIf}

  ; shortcuts
  CreateShortcut "$DESKTOP\JewelleryApp.lnk" "$INSTDIR\JewelleryApp.exe" "" "$INSTDIR\jewelleryapp.ico"
  CreateDirectory "$SMPROGRAMS\${APP}"
  CreateShortcut "$SMPROGRAMS\${APP}\JewelleryApp.lnk" "$INSTDIR\JewelleryApp.exe" "" "$INSTDIR\jewelleryapp.ico"
  CreateShortcut "$SMPROGRAMS\${APP}\User guide and setup.lnk" "$INSTDIR\docs\index.html"
  CreateShortcut "$SMPROGRAMS\${APP}\Data and backups folder.lnk" "$DataDir"
  CreateShortcut "$SMPROGRAMS\${APP}\Uninstall JewelleryApp.lnk" "$INSTDIR\uninstall.exe"

  ; Add / Remove Programs
  WriteRegStr HKLM "Software\${APP}" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\${APP}" "DataDir" "$DataDir"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayName" "${APP}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "Publisher" "Nisarg Jewellers"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\jewelleryapp.ico"
  WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

Section "Uninstall"
  SetShellVarContext all
  SetRegView 64
  ReadRegStr $DataDir HKLM "Software\${APP}" "DataDir"
  DetailPrint "Stopping and removing the JewelleryApp Database service..."
  nsExec::ExecToLog '"$INSTDIR\jewellery-server.exe" service stop'
  Sleep 2000
  nsExec::ExecToLog '"$INSTDIR\jewellery-server.exe" service uninstall'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="JewelleryApp"'

  Delete "$DESKTOP\JewelleryApp.lnk"
  RMDir /r "$SMPROGRAMS\${APP}"
  Delete "$INSTDIR\jewellery-server.exe"
  Delete "$INSTDIR\JewelleryApp.exe"
  Delete "$INSTDIR\jewellery.json"
  Delete "$INSTDIR\jewelleryapp.ico"
  RMDir /r "$INSTDIR\docs"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"

  DeleteRegKey HKLM "${UNINST_KEY}"
  DeleteRegValue HKLM "Software\${APP}" "InstallDir"
  ; DataDir is kept so a re-install finds the same data
  MessageBox MB_ICONINFORMATION "JewelleryApp was removed. Your data and backups were NOT deleted:$\r$\n$DataDir"
SectionEnd
