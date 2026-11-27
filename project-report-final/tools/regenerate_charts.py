from pathlib import Path
import json
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
OUT=Path(__file__).resolve().parents[1]
FIG=OUT/'figures'
summary=json.loads((OUT/'evidence/evaluation_summary.json').read_text())
ai={'cases':[{'latency_ms':c['latency_ms'],'answer':{'mode':c['mode']}} for c in summary['ai_cases']]}
plt.rcParams.update({'font.family':'DejaVu Serif','font.size':10,'axes.spines.top':False,'axes.spines.right':False,'pdf.fonttype':42,'savefig.bbox':'tight'})
navy='#243d56';slate='#678195';grey='#aeb8c1'
def save(name):
 plt.tight_layout();plt.savefig(FIG/'charts'/f'{name}.pdf');plt.close()
def bars(name,labels,values,ylabel,top=None):
 fig,ax=plt.subplots(figsize=(6.7,3.0));b=ax.bar(labels,values,color=[navy,slate,grey,navy][:len(labels)],edgecolor='black',linewidth=.5)
 for rect,v in zip(b,values):ax.annotate(f'{v:.2f}' if isinstance(v,float) else str(v),(rect.get_x()+rect.get_width()/2,rect.get_height()),xytext=(0,4),textcoords='offset points',ha='center',fontsize=9)
 ax.set_ylabel(ylabel);ax.set_ylim(0,top or max(values)*1.22);ax.grid(axis='y',alpha=.2);ax.set_axisbelow(True);save(name)
bars('test_distribution',['Backend','Frontend','Python','Infrastructure'],[298,57,83,22],'Passed tests (separate suite executions)')
modes=['semantic','lexical','hybrid'];labels=['Dense semantic','BM25','Hybrid']
bars('search_top1',labels,[summary['search'][m]['top1_accuracy']*100 for m in modes],'Positive top-1 accuracy (%) · n = 69',110)
bars('negative_rejection',labels,[summary['search'][m]['correct_abstentions']/15*100 for m in modes],'Correct negative rejection (%) · n = 15',110)
fig,ax=plt.subplots(figsize=(6.7,3));x=np.arange(3);w=.25
for j,(key,label) in enumerate([('top3_success','Top-3 hit'),('recall_at_3','Recall@3'),('mrr','MRR')]):ax.bar(x+(j-1)*w,[summary['search'][m][key] for m in modes],w,label=label,color=[navy,slate,grey][j],edgecolor='black',linewidth=.4)
ax.set_xticks(x,labels);ax.set_ylim(0,1.16);ax.set_ylabel('Score (0–1)');ax.legend(ncol=3,loc='upper center',fontsize=8);save('ranking_metrics')
fig,ax=plt.subplots(figsize=(6.7,3));x=np.arange(3)
for j,(key,label) in enumerate([('median_latency_ms','Median'),('p95_latency_ms','P95')]):ax.bar(x+(j-.5)*.3,[summary['search'][m][key] for m in modes],.3,label=label,color=[navy,grey][j],edgecolor='black',linewidth=.4)
ax.set_xticks(x,labels);ax.set_ylim(bottom=0);ax.set_ylabel('Adapter request latency (ms)');ax.legend();save('retrieval_latency')
bars('ai_outcomes',['Generated / answerable','Abstained / unanswerable'],[31,9],'Strictly accepted cases · total n = 40')
fig,ax=plt.subplots(figsize=(6.7,3));data=[[c['latency_ms']/1000 for c in ai['cases'] if c['answer']['mode']==mode] for mode in ['generated','insufficient']]
ax.boxplot(data,tick_labels=['Generated (n=31)','Abstained (n=9)'],showmeans=True);ax.set_ylabel('End-to-end adapter time (s)');ax.set_ylim(bottom=0);save('ai_latency')
bars('startup_phases',['Torch import','ST import','Model load','First encode','Warm encode'],[1.63059,3.74030,.73205,.42617,.02095],'Fresh-process phase duration (s)')
bars('monthly_cost',['Stopped','1 h/day','2 h/day','4 h/day','24 h/day'],[2.88,6.673,10.4659,18.0518,93.911],'Illustrative gross USD/month (730 h basis)')
