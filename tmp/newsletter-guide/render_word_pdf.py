import os, sys, importlib.util, shutil
from pathlib import Path
ROOT=Path(r'D:\AXIS-Customer-Communication-Platform')
SKILL=Path(r'C:\Users\FAHED\.codex\plugins\cache\openai-primary-runtime\documents\26.904.11930\skills\documents\render_docx.py')
POPPLER=r'C:\Users\FAHED\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin'
os.environ['PATH']=POPPLER+os.pathsep+os.environ.get('PATH','')
spec=importlib.util.spec_from_file_location('packaged_docx_renderer',SKILL)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
pdf=ROOT/'output/pdf/AXIS_Monday_Newsletter_Step_by_Step_Guide.pdf'
def use_word_pdf(doc_path,user_profile,convert_tmp_dir,stem,verbose):
    target=Path(convert_tmp_dir)/(stem+'.pdf')
    shutil.copy2(pdf,target)
    return str(target),'Microsoft Word fixed-format export used because bundled LibreOffice is unavailable on Windows.'
mod.convert_to_pdf=use_word_pdf
pages=mod.rasterize(str(ROOT/'output/docs/AXIS_Monday_Newsletter_Step_by_Step_Guide.docx'),str(ROOT/'tmp/newsletter-guide/render'),120,verbose=True,emit_pdf=False)
print(f'Rendered {len(pages)} page images')
