#!/bin/zsh
# Build 3DSlides.app next to code/ and register it: <name>.3Dslides folders then show in Finder as one file
# (a package: right-click > Show Package Contents to see deck.js, scenes/, assets/), and double-clicking one
# opens it in the 3D Slides editor (code/tools/open_deck.sh). Double-clicking the app itself opens the
# default deck. Run again after moving the 3DSlides folder.
#   zsh code/tools/make_app.sh
set -e
root="$(cd "$(dirname "$0")/../.." && pwd -P)"
app="$root/3DSlides.app"
plist="$app/Contents/Info.plist"
pb=/usr/libexec/PlistBuddy

rm -rf "$app"
osacompile -o "$app" <<'APPLESCRIPT'
on run
	openDeck("")
end run

on open theFiles
	repeat with f in theFiles
		openDeck(POSIX path of f)
	end repeat
end open

on openDeck(p)
	set launcher to (POSIX path of (path to me)) & "../code/tools/open_deck.sh"
	try
		do shell script "/bin/zsh -lc " & quoted form of (quoted form of launcher & " " & quoted form of p)
	on error msg
		display dialog msg with title "3D Slides" buttons {"OK"} default button "OK" with icon caution
	end try
end openDeck
APPLESCRIPT

$pb -c "Set :CFBundleName 3D Slides" "$plist"
$pb -c "Add :CFBundleDisplayName string 3D Slides" "$plist" 2>/dev/null || true
$pb -c "Add :CFBundleIdentifier string local.threedslides.app" "$plist" 2>/dev/null || $pb -c "Set :CFBundleIdentifier local.threedslides.app" "$plist"
# the deck type: a folder (package) with the extension .3Dslides
$pb -c "Add :UTExportedTypeDeclarations array" "$plist"
$pb -c "Add :UTExportedTypeDeclarations:0 dict" "$plist"
$pb -c "Add :UTExportedTypeDeclarations:0:UTTypeIdentifier string local.threedslides.deck" "$plist"
$pb -c "Add :UTExportedTypeDeclarations:0:UTTypeDescription string 3D Slides deck" "$plist"
$pb -c "Add :UTExportedTypeDeclarations:0:UTTypeConformsTo array" "$plist"
$pb -c "Add :UTExportedTypeDeclarations:0:UTTypeConformsTo:0 string com.apple.package" "$plist"
$pb -c "Add :UTExportedTypeDeclarations:0:UTTypeConformsTo:1 string public.composite-content" "$plist"
$pb -c "Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification dict" "$plist"
$pb -c "Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension array" "$plist"
$pb -c "Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension:0 string 3Dslides" "$plist"
$pb -c "Add :UTExportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension:1 string 3dslides" "$plist"
# this app opens it
$pb -c "Delete :CFBundleDocumentTypes" "$plist" 2>/dev/null || true
$pb -c "Add :CFBundleDocumentTypes array" "$plist"
$pb -c "Add :CFBundleDocumentTypes:0 dict" "$plist"
$pb -c "Add :CFBundleDocumentTypes:0:CFBundleTypeName string 3D Slides deck" "$plist"
$pb -c "Add :CFBundleDocumentTypes:0:CFBundleTypeRole string Editor" "$plist"
$pb -c "Add :CFBundleDocumentTypes:0:LSHandlerRank string Owner" "$plist"
$pb -c "Add :CFBundleDocumentTypes:0:LSTypeIsPackage bool true" "$plist"
$pb -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes array" "$plist"
$pb -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes:0 string local.threedslides.deck" "$plist"

codesign --force --deep -s - "$app" 2>/dev/null || true
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app"
touch "$root"/*.3Dslides(N/)      # Finder looks at them again
echo "made $app"
