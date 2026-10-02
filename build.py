from pathlib import Path
import zipfile,json,sys
root=Path(__file__).parent
manifest=json.loads((root/'manifest.json').read_text())
# --atn builds the addons.thunderbird.net upload: ATN delivers updates for listed add-ons itself,
# so the self-hosted update_url is left out of that package.
atn='--atn' in sys.argv[1:]
if atn:manifest['browser_specific_settings']['gecko'].pop('update_url',None)
output=root/'dist'/f"threads-{manifest['version']}{'-atn' if atn else ''}.xpi"
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('manifest.json',json.dumps(manifest,indent=2,ensure_ascii=False)+'\n')
    for folder in ['src','experiment']:
        for path in sorted((root/folder).rglob('*')):
            if path.is_file():
                if path == root/'experiment'/'api.js':
                    controller=(root/'experiment'/'pane-controller.js').read_text()
                    archive.writestr('experiment/api.js',controller+'\n'+path.read_text())
                elif path != root/'experiment'/'pane-controller.js':
                    archive.write(path,path.relative_to(root))
print(output)
