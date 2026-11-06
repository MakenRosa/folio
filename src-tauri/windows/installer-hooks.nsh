; Folio is offered in "Open with" for .pdf, and is never made the default program of PDFs.
;
; The file association of Tauri (bundle > fileAssociations) writes the class "Folio.PDF" and then
; makes it the program of .pdf for the user: it sets the default value of
; HKCU\Software\Classes\.pdf, and keeps the previous one in the value "Folio.PDF_backup". Without
; a choice made by the user in Windows (Settings > Default apps) that would open every PDF in
; Folio. The hooks keep the class and undo the rest: the previous program of .pdf comes back, and
; Folio is listed in OpenWithProgids, which is what "Open with" reads.
;
; Only keys of the current user are touched, and only Folio's own class and values are removed.

!macro NSIS_HOOK_POSTINSTALL
  Push $R0
  ReadRegStr $R0 SHCTX "Software\Classes\.pdf" "Folio.PDF_backup"
  ; Nothing before it, or an association that was already ours: .pdf goes back to having no
  ; program of its own at this level, which leaves it to the user's choice and to the system.
  ${If} $R0 == ""
  ${OrIf} $R0 == "Folio.PDF"
    DeleteRegValue SHCTX "Software\Classes\.pdf" ""
  ${Else}
    WriteRegStr SHCTX "Software\Classes\.pdf" "" "$R0"
  ${EndIf}
  DeleteRegValue SHCTX "Software\Classes\.pdf" "Folio.PDF_backup"
  WriteRegStr SHCTX "Software\Classes\.pdf\OpenWithProgids" "Folio.PDF" ""
  !insertmacro UPDATEFILEASSOC
  Pop $R0
!macroend

; The uninstaller of Tauri restores the value that "Folio.PDF_backup" holds. It is set to the
; program that .pdf has now, so that the uninstall does not undo a choice made after the install.
!macro NSIS_HOOK_PREUNINSTALL
  Push $R0
  ReadRegStr $R0 SHCTX "Software\Classes\.pdf" ""
  WriteRegStr SHCTX "Software\Classes\.pdf" "Folio.PDF_backup" "$R0"
  Pop $R0
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Push $R0
  ; The class is gone: a default value that still names it, or an empty one that the uninstaller
  ; wrote, would leave .pdf pointing at nothing.
  ReadRegStr $R0 SHCTX "Software\Classes\.pdf" ""
  ${If} $R0 == ""
  ${OrIf} $R0 == "Folio.PDF"
    DeleteRegValue SHCTX "Software\Classes\.pdf" ""
  ${EndIf}
  DeleteRegValue SHCTX "Software\Classes\.pdf" "Folio.PDF_backup"
  DeleteRegValue SHCTX "Software\Classes\.pdf\OpenWithProgids" "Folio.PDF"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.pdf\OpenWithProgids"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.pdf"
  !insertmacro UPDATEFILEASSOC
  Pop $R0
!macroend
