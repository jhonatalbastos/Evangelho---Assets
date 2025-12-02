import React,{useState,useEffect} from 'react';
import {LiturgyData,Roteiro,VisualStyle,VoiceOption,IntroStyle,ProcessingState,GeneratedAsset,JobPayload,ScriptBlock,ImageModel} from './types';
import * as gasService from './services/gasService';
import * as geminiService from './services/geminiService';
import * as liturgyService from './services/liturgyService';
import * as utils from './utils';
import BlockCard from './components/BlockCard';
import {logger} from './services/logger';

const CHARACTER_DESCRIPTIONS={"Jesus":"Historical representation, Middle Eastern features, tan skin, shoulder-length dark brown wavy hair, short beard, kind and compassionate eyes, wearing a simple textured beige or off-white tunic with a red sash. Humble yet majestic presence.","Abraham":"Elderly patriarch, weathered face showing wisdom, very long white beard, wearing nomadic desert robes in earth tones (browns and greys), holding a wooden staff. Presence of faith and endurance.","David":"(If young): Young shepherd, ruddy complexion, reddish-brown curly hair, carrying a leather sling and a shepherd's crook, simple tunic. (If King): Mature, wearing a modest gold crown, royal robes of deep blue and purple, holding a harp.","Goliath":"Massive Philistine giant, towering height, muscular build, wearing heavy bronze scale armor, bronze helmet with a crest, holding a gigantic spear and shield. Intimidating and warlike.","Solomon":"King in opulent royal attire, rich gold and embroidery, wearing a sophisticated crown, trimmed beard, wise expression. Often depicted in a palace setting or near a temple.","Moses":"Strong leader, long grey beard and hair, wearing a simple rough robe, holding a large wooden staff (rod of God). Intense, glowing expression on his face after being in God's presence.","Mary (Mother of Jesus)":"Young Middle Eastern woman (or mature, depending on context), gentle face, wearing a simple blue head covering (veil) and white tunic. Expression of purity and contemplation.","Peter (Apostle)":"Rugged fisherman, muscular build, short grey curly hair and thick beard, wearing rough, simple clothes. Impulsive but passionate expression.","Paul (Apostle)":"Bald or balding head, dark beard, intense intellectual gaze, holding a scroll or parchment. Wearing traveling robes."};

function generateBlockImagePrompt(
  blockId: keyof Roteiro,
  basePrompt: string, // This is the prompt from the Roteiro block
  roteiro: Roteiro,
  characterDescriptions: typeof CHARACTER_DESCRIPTIONS
): string {
  let currentImagePrompt = '';

  switch(blockId) {
    case 'hook':
      const leituraTextForHook = roteiro.leitura?.text?.substring(0, 500) || "the daily bible reading";
      currentImagePrompt = `An impactful, curiosity-generating visual hook based on the daily liturgical reading: "${leituraTextForHook}". Focus on a mysterious or intriguing central scene related to the core theme. Strictly single scene. Avoid multiple views. No Bible or scripture text.`;
      break;
    case 'leitura':
      currentImagePrompt = `A single, continuous, cinematic scene that faithfully represents the main scene described: "${basePrompt.substring(0, 500)}". Show the actual event, characters, and setting referred to in the Scripture. Do not depict a Bible.`;
      break;
    case 'reflexao':
      const reflexaoText = roteiro.reflexao?.text?.substring(0, 500) || "the reflection topic";
      const jesusDescReflexao = characterDescriptions["Jesus"];
      currentImagePrompt = `${jesusDescReflexao}. Jesus with a modern-day viewer, engaging in a calm moment of dialogue. They are in a single peaceful environment, connected thematically to the reflection: "${reflexaoText}". The scene symbolizes Jesus helping the viewer understand the meaning of the passage.`;
      break;
    case 'aplicacao':
      const aplicacaoText = roteiro.aplicacao?.text?.substring(0, 500) || "the application topic";
      const jesusDescAplicacao = characterDescriptions["Jesus"];
      currentImagePrompt = `${jesusDescAplicacao}. Jesus accompanying a modern-day viewer, gently guiding them on how to apply the teaching in their daily life. Both are in a single, natural, candid modern-day environment (such as a home, street, workplace, or park), with Jesus encouraging and teaching. Focus on practical spiritual guidance related to: "${aplicacaoText}".`;
      break;
    case 'oracao':
      const oracaoText = roteiro.oracao?.text?.substring(0, 500) || "the prayer topic";
      const jesusDescOracao = characterDescriptions["Jesus"];
      currentImagePrompt = `${jesusDescOracao}. Jesus praying together with a modern-day viewer in a unified, serene setting that evokes peace, devotion, and closeness to God. The viewer is a normal modern-day person, and Jesus is respectfully depicted beside them. Focus on the intimacy of the moment. Related to: "${oracaoText}".`;
      break;
    default:
      currentImagePrompt = basePrompt; // If for some reason a block doesn't match, use its raw prompt.
      break;
  }
  return currentImagePrompt;
}

const App:React.FC=()=>{
const [dateStr,setDateStr]=useState(new Date().toISOString().split('T')[0]);
const [category,setCategory]=useState('evangelho');
const [liturgy,setLiturgy]=useState<LiturgyData|null>(null);
const [reference,setReference]=useState('');
const [introStyle,setIntroStyle]=useState<IntroStyle>(IntroStyle.Viral);
const [visualStyle,setVisualStyle]=useState<VisualStyle>(VisualStyle.Cinematic);
const [imageModel,setImageModel]=useState<ImageModel>(ImageModel.Flash);
const [audioVoice,setAudioVoice]=useState<VoiceOption>(VoiceOption.Alnilam);
const [videoResolution,setVideoResolution]=useState('9:16 (Vertical/Stories)');
const [roteiro,setRoteiro]=useState<Roteiro|null>(null);
const [processingState,setProcessingState]=useState<ProcessingState>(ProcessingState.Idle);
const [progressMsg,setProgressMsg]=useState('');
const [errorMessage,setErrorMessage]=useState('');
const [successMessage,setSuccessMessage]=useState('');
const [quotaExceededMessage,setQuotaExceededMessage]=useState(false);
const [jobId,setJobId]=useState('');
const [fetchSource,setFetchSource]=useState('');

useEffect(()=>{
logger.info('App initialized');
},[]);

useEffect(()=>{
if(dateStr){
handleFetchLiturgy();
}
},[dateStr]);

useEffect(()=>{
if(liturgy){
let ref="";
if(category==='evangelho')ref=liturgy.evangelho;
else if(category==='primeira_leitura')ref=liturgy.primeira_leitura;
else if(category==='segunda_leitura')ref=liturgy.segunda_leitura;
else if(category==='salmo')ref=liturgy.salmo;
setReference(ref||"Referência não disponível");
}
},[category,liturgy]);

const handleFetchLiturgy=async()=>{
setProcessingState(ProcessingState.FetchingLiturgy);
setErrorMessage('');
setLiturgy(null);
setFetchSource('');
setRoteiro(null);
logger.info(`Starting liturgy fetch for date: ${dateStr}`);
try{
logger.info("Attempting Direct API fetch...");
const data=await liturgyService.fetchLiturgyFromApi(dateStr);
setLiturgy(data);
setFetchSource('API');
setProcessingState(ProcessingState.Idle);
logger.info("Liturgy fetched successfully from API.");
}catch(apiError:any){
logger.warn("API fetch failed, switching to AI Search Fallback.",apiError);
if(!window.aistudio||!(await window.aistudio.hasSelectedApiKey())){
setQuotaExceededMessage(true);
setProcessingState(ProcessingState.Error);
setErrorMessage("API Key not selected or configured. Please select a paid API key for AI Search functions.");
logger.error("API Key missing for AI Search fallback.",apiError);
return;
}
try{
const fallbackData=await geminiService.fetchLiturgyFallback(dateStr,category);
setLiturgy(fallbackData);
setFetchSource('Search/AI');
setProcessingState(ProcessingState.Idle);
logger.info("Liturgy fetched successfully from Gemini Search Fallback.");
}catch(aiError:any){
const msg=`Failed to fetch liturgy from both API and Search: ${aiError.message}`;
setErrorMessage(msg);
setProcessingState(ProcessingState.Error);
logger.error(msg,aiError);
}
}
};

const handleGenerateScript=async()=>{
if(!liturgy){
setErrorMessage("Please fetch liturgy first.");
logger.warn("Script generation attempted without fetched liturgy.");
return;
}
const currentReference=reference;
if(!currentReference){
setErrorMessage("No reference available for script generation. Please fetch liturgy or enter a manual reference.");
setProcessingState(ProcessingState.Error);
logger.error("No reference provided for script generation.");
return;
}
if(!window.aistudio||!(await window.aistudio.hasSelectedApiKey())){
setQuotaExceededMessage(true);
setErrorMessage("API Key not selected or configured. Please select a paid API key for AI Script generation.");
logger.error("API Key missing for AI Script generation.");
return;
}
setProcessingState(ProcessingState.GeneratingScript);
setProgressMsg('Consulting Gemini for script & prompts...');
setErrorMessage('');
logger.info("Starting script generation with Gemini...");
let textToUse="";
if(category==='evangelho')textToUse=liturgy?.texto_evangelho||"";
else if(category==='primeira_leitura'&&liturgy?.texto_primeira_leitura)textToUse=liturgy.texto_primeira_leitura;
else if(category==='segunda_leitura'&&liturgy?.texto_segunda_leitura)textToUse=liturgy.texto_segunda_leitura;
else if(category==='salmo'&&liturgy?.texto_salmo)textToUse=liturgy.texto_salmo;

if(!textToUse&&liturgy?.texto_evangelho){
textToUse=liturgy.texto_evangelho;
logger.warn("Specific category text missing, falling back to Gospel text for script generation.");
}
if(!textToUse){
setErrorMessage("No text available for the selected category to generate a script.");
setProcessingState(ProcessingState.Error);
logger.error("No text available for script generation.", {category,liturgy});
return;
}
try{
const generatedParts=await geminiService.generateScript(currentReference,textToUse,visualStyle,introStyle);
const formattedReadingText=liturgyService.formatLiturgicalReading(textToUse,currentReference);
const fullRoteiro:Roteiro={
hook:generatedParts.hook||{text:'',prompt:''},
leitura:{text:formattedReadingText,prompt:generatedParts.prompt_leitura||''},
reflexao:generatedParts.reflexao||{text:'',prompt:''},
aplicacao:generatedParts.aplicacao||{text:'',prompt:''},
oracao:generatedParts.oracao||{text:'',prompt:''},
};
setRoteiro(fullRoteiro);
setProcessingState(ProcessingState.Idle);
logger.info("Script generation completed successfully.",fullRoteiro);
}catch(e:any){
const msg=`Script generation failed: ${e.message}`;
setErrorMessage(msg);
if(e.message&&(e.message.includes('429')||e.message.includes('RESOURCE_EXHAUSTED'))){
setQuotaExceededMessage(true);
}
setProcessingState(ProcessingState.Error);
logger.error(msg,e);
}
};

const handleFullAutomation=async()=>{
if(!roteiro){
setErrorMessage("Please generate a script first.");
logger.warn("Full automation attempted without a generated script.");
return;
}
const currentReference=reference;
if(!window.aistudio||!(await window.aistudio.hasSelectedApiKey())){
setQuotaExceededMessage(true);
setErrorMessage("API Key not selected or configured. Please select a paid API key for AI Media generation and upload.");
logger.error("API Key missing for AI Media generation.");
return;
}
setProcessingState(ProcessingState.GeneratingMedia);
setErrorMessage('');
setSuccessMessage('');
setQuotaExceededMessage(false);
logger.info("Starting full automation flow: generating media and uploading...");

try{
const assets:GeneratedAsset[]=[];
const aspectRatioForImageGen=(()=>{
if(videoResolution.includes("9:16"))return "9:16";
if(videoResolution.includes("16:9"))return "16:9";
return "1:1";
})();

const blocks:{id:keyof Roteiro,data?:ScriptBlock}[]=[
{id:'hook',data:roteiro.hook},
{id:'leitura',data:roteiro.leitura},
{id:'reflexao',data:roteiro.reflexao},
{id:'aplicacao',data:roteiro.aplicacao},
{id:'oracao',data:roteiro.oracao},
];

let completedAssetCount=0;
for(const block of blocks){
if(!block.data){
logger.warn(`Skipping block ${block.id} due to missing script data.`);
setErrorMessage(prev=>prev+`Missing script data for ${block.id}. `);
continue;
}

setProgressMsg(`Generating Assets for: ${block.id.toUpperCase()}...`);
logger.info(`Generating assets for block: ${block.id}`);

const currentImagePrompt = generateBlockImagePrompt(block.id, block.data.prompt, roteiro, CHARACTER_DESCRIPTIONS);

try{
const imgB64=await geminiService.generateImage(currentImagePrompt,visualStyle,aspectRatioForImageGen,imageModel);
assets.push({block_id:block.id,type:'image',data_b64:imgB64});
completedAssetCount++;
}catch(e:any){
logger.error(`Failed to generate image for block: ${block.id}`,e,{prompt:currentImagePrompt.substring(0,100),visualStyle,aspectRatio:aspectRatioForImageGen,imageModel});
if(e.message&&(e.message.includes('429')||e.message.includes('RESOURCE_EXHAUSTED'))){
setQuotaExceededMessage(true);
setProcessingState(ProcessingState.Error);
setErrorMessage(`Image generation failed due to quota limits for block ${block.id}. Please select a paid API key.`);
return;
}
setErrorMessage(prev=>prev+`Failed image for ${block.id}. `);
}

try{
const pcmB64=await geminiService.generateSpeech(block.data.text,audioVoice);
if(!pcmB64||pcmB64.length<100){
throw new Error(`Audio generated for ${block.id} is seemingly empty or invalid.`);
}
const pcmBytes=utils.decode(pcmB64);
const wavBytes=utils.pcmToWav(pcmBytes,24000,1,16);
const audioB64_wav=utils.encode(wavBytes);
assets.push({block_id:block.id,type:'audio',data_b64:audioB64_wav});
completedAssetCount++;
}catch(e:any){
logger.error(`Failed to generate audio for block: ${block.id}`,e,{text:block.data.text.substring(0,100),audioVoice});
if(e.message&&(e.message.includes('429')||e.message.includes('RESOURCE_EXHAUSTED'))){
setQuotaExceededMessage(true);
setProcessingState(ProcessingState.Error);
setErrorMessage(`Audio generation failed due to quota limits for block ${block.id}. Please select a paid API key.`);
return;
}
setErrorMessage(prev=>prev+`Failed audio for ${block.id}. `);
}
logger.info(`Generated ${completedAssetCount} individual assets (images/audio).`);
}

const expectedAssets=blocks.filter(b=>b.data).length*2;
if(assets.length<expectedAssets){
setProcessingState(ProcessingState.Error);
setErrorMessage(prev=>prev||"Some media assets failed to generate. Please check logs for details.");
return;
}

setProgressMsg("Calculating timings and generating Subtitles (SRT)...");
logger.info("Generating SRT file...");
const roteiroTextMap=utils.mapRoteiroToTextMap(roteiro);
try{
const srtB64=await utils.generateSRT(assets,roteiroTextMap);
assets.push({block_id:'legendas',type:'srt',data_b64:srtB64});
logger.info("SRT generated successfully.");
}catch(e:any){
logger.error("Failed to generate SRT",e);
setErrorMessage(prev=>prev+`Failed to generate SRT. `);
setProcessingState(ProcessingState.Error);
return;
}

setProgressMsg("Uploading content bundle to Google Drive via GAS...");
logger.info("Preparing payload for GAS upload.");
const payload:JobPayload={
assets:assets,
roteiro:roteiro,
meta_dados:{data:dateStr,ref:currentReference},
leitura_montada:roteiro.leitura?.text||""
};

try{
const returnedJobId=await gasService.sendJobToGAS(payload);
setJobId(returnedJobId);
setSuccessMessage(`Content bundle uploaded successfully! Job ID: ${returnedJobId}`);
setProcessingState(ProcessingState.Complete);
logger.info(`Full automation complete. Job ID: ${returnedJobId}`);
}catch(e:any){
logger.error("Failed to upload job to GAS",e);
setErrorMessage(prev=>prev+`Failed to upload job to Google Drive: ${e.message}.`);
setProcessingState(ProcessingState.Error);
}

}catch(e:any){
const msg=`Automation failed: ${e.message}`;
setErrorMessage(msg);
setProcessingState(ProcessingState.Error);
logger.error(msg,e);
}
};

const handleTestConnection=async()=>{
setProcessingState(ProcessingState.Uploading);
setProgressMsg("Sending test packet to Google Apps Script...");
setErrorMessage('');
setSuccessMessage('');
setQuotaExceededMessage(false);
logger.info("Initiating GAS connection test.");
try{
const testJobId=await gasService.sendTestJob();
setSuccessMessage(`Connection Verified! Test Job ID: ${testJobId}`);
setProcessingState(ProcessingState.Idle);
logger.info(`GAS connection test successful. Test Job ID: ${testJobId}`);
}catch(e:any){
const msg=`Connection Test Failed: ${e.message}`;
setErrorMessage(msg);
setProcessingState(ProcessingState.Error);
logger.error(msg,e);
}
};

const handleSelectApiKey=async()=>{
try{
await window.aistudio!.openSelectKey();
setQuotaExceededMessage(false);
setErrorMessage('');
setProcessingState(ProcessingState.Idle);
logger.info('User opened API key selection dialog. Resetting state.');
}catch(e:any){
logger.error('Failed to open API key selection dialog',e);
setErrorMessage('Failed to open API key selection dialog: '+e.message);
}
};

const isBusy=processingState!==ProcessingState.Idle&&processingState!==ProcessingState.Complete&&processingState!==ProcessingState.Error;

return(
<div className="min-h-screen flex flex-col items-center justify-center p-4 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-100 via-slate-50 to-white">
<main className="w-full max-w-5xl bg-white shadow-2xl rounded-3xl p-6 md:p-10 border border-indigo-50/50">
<header className="text-center mb-10">
<h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600 tracking-tight mb-2">Monetiza Studio</h1>
<p className="text-lg text-slate-500 font-medium">Automated Liturgical Content Factory</p>
</header>

<section className="bg-slate-50/80 p-6 rounded-2xl border border-slate-200 mb-8 backdrop-blur-sm">
<h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
<span className="bg-indigo-600 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm">1</span>Content Configuration
</h2>
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-4">
<div>
<label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Category</label>
<select
value={category}
onChange={e=>setCategory(e.target.value)}
className="w-full p-3 bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
disabled={isBusy}
>
<option value="evangelho">Evangelho</option>
<option value="primeira_leitura">1ª Leitura</option>
<option value="salmo">Salmo</option>
<option value="segunda_leitura">2ª Leitura</option>
</select>
</div>
<div>
<label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Date</label>
<input
type="date"
value={dateStr}
onChange={e=>setDateStr(e.target.value)}
className="w-full p-3 bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
disabled={isBusy}
/>
</div>
<div className="lg:col-span-2">
<label className="block text-xs font-semibold text-slate-500 uppercase mb-1 flex justify-between">
<span>Reference</span>
{fetchSource&&<span className={`text-[10px] px-2 py-0.5 rounded-full ${fetchSource==='API'?'bg-green-100 text-green-700':'bg-blue-100 text-blue-700'}`}>Source: {fetchSource}</span>}
</label>
<input
type="text"
value={reference}
onChange={e=>setReference(e.target.value)}
placeholder={processingState===ProcessingState.FetchingLiturgy?"Fetching (API or AI Search)...":"Liturgical Reference"}
className={`w-full p-3 border rounded-xl text-indigo-700 font-semibold ${isBusy?'bg-slate-100 border-slate-300 cursor-not-allowed':'bg-white border-indigo-300 focus:ring-2 focus:ring-indigo-500 outline-none'}`}
disabled={isBusy}
/>
</div>
<div>
<label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Hook Style</label>
<select
value={introStyle}
onChange={e=>setIntroStyle(e.target.value as IntroStyle)}
className="w-full p-3 bg-white border border-yellow-400 rounded-xl focus:ring-2 focus:ring-yellow-500 outline-none text-slate-700 font-medium"
disabled={isBusy}
>
{Object.values(IntroStyle).map(s=><option key={s}value={s}>{s}</option>)}
</select>
</div>
<div>
<label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Visual Style</label>
<select
value={visualStyle}
onChange={e=>setVisualStyle(e.target.value as VisualStyle)}
className="w-full p-3 bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-slate-700 font-medium"
disabled={isBusy}
>
{Object.values(VisualStyle).map(s=><option key={s}value={s}>{s}</option>)}
</select>
</div>
<div>
<label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Image Model</label>
<select
value={imageModel}
onChange={e=>setImageModel(e.target.value as ImageModel)}
className="w-full p-3 bg-white border border-indigo-400 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-slate-700 font-medium"
disabled={isBusy}
>
{Object.values(ImageModel).map(m=><option key={m}value={m}>{m === ImageModel.Flash ? 'Gemini Flash (Free Tier)' : 'Gemini Pro (Paid Tier)'}</option>)}
</select>
</div>
<div className="lg:col-span-1">
<label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Video Resolution</label>
<select
value={videoResolution}
onChange={e=>setVideoResolution(e.target.value)}
className="w-full p-3 bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-slate-700 font-medium"
disabled={isBusy}
>
<option value="9:16 (Vertical/Stories)">9:16 (Vertical/Stories)</option>
<option value="16:9 (Horizontal/YouTube)">16:9 (Horizontal/YouTube)</option>
<option value="1:1 (Square/Feed)">1:1 (Square/Feed)</option>
</select>
</div>
</div>
<div className="mt-4 text-sm text-slate-600 flex justify-around items-center">
<span>Current Image Model: <span className="font-semibold text-indigo-700">{imageModel === ImageModel.Flash ? 'Gemini Flash' : 'Gemini Pro'}</span></span>
<span>Current Audio Voice: <span className="font-semibold text-indigo-700">{audioVoice}</span></span>
</div>
</section>

{!roteiro&&(
<div className="flex justify-center mb-8">
<button
onClick={handleGenerateScript}
disabled={isBusy||!liturgy||quotaExceededMessage}
className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold py-4 px-10 rounded-full shadow-lg transform transition active:scale-95 text-xl flex items-center gap-3"
>
{processingState===ProcessingState.GeneratingScript?(
<><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>Drafting Script...</>
):(
<>✍️ Generate Script (Gemini)</>
)}
</button>
</div>
)}

{roteiro&&(
<section className="animate-fade-in-up">
<div className="flex justify-between items-center mb-6">
<h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
<span className="bg-purple-600 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm">2</span>Review & Finalize
</h2>
<div className="flex gap-4 items-center">
<label htmlFor="voice-select"className="text-sm font-semibold text-slate-600">Voice:</label>
<select
id="voice-select"
value={audioVoice}
onChange={e=>setAudioVoice(e.target.value as VoiceOption)}
disabled={isBusy}
className="p-2 border rounded-lg text-sm bg-white"
>
{Object.values(VoiceOption).map(v=><option key={v}value={v}>{v}</option>)}
</select>
</div>
</div>

<div className="grid grid-cols-1 gap-4 mb-8">
{Object.keys(roteiro).map((key:string)=>{
const blockId=key as keyof Roteiro;
const blockData=roteiro[blockId];
if(blockData&&typeof blockData==='object'&&'text'in blockData){
return(
<BlockCard
key={blockId}
title={blockId.toUpperCase()}
color={blockId==='hook'||blockId==='oracao'?'primary':blockId==='leitura'?'quaternary':blockId==='reflexao'?'secondary':'tertiary'}
blockData={blockData as ScriptBlock}
onBlockDataChange={data=>setRoteiro({...roteiro,[blockId]:data})}
readOnly={isBusy}
/>
);
}
return null;
})}
</div>

<div className="mt-8 text-center">
{jobId?(
<div className="bg-green-100 border-2 border-green-500 text-green-800 p-6 rounded-2xl animate-bounce-in max-w-sm mx-auto">
<p className="font-bold text-lg mb-2">SUCCESS! JOB ID GENERATED:</p>
<p className="text-3xl font-mono select-all bg-white inline-block px-4 py-2 rounded-lg shadow-sm">{jobId}</p>
<p className="text-sm mt-3 text-green-700">Copy this ID to your Python Video Builder app.</p>
</div>
):(
<div className="flex flex-col gap-4 items-center">
<button
onClick={handleFullAutomation}
disabled={isBusy||quotaExceededMessage}
className="w-full md:w-auto bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 text-white font-bold py-4 px-12 rounded-full shadow-lg transform transition active:scale-95 text-xl flex flex-col items-center justify-center mx-auto"
>
{isBusy&&processingState!==ProcessingState.Uploading?(
<div className="flex items-center gap-3">
<div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
<span>{progressMsg}</span>
</div>
):(
<>✨ GENERATE MEDIA & UPLOAD (Drive)</>
)}
</button>
<button
onClick={handleTestConnection}
disabled={isBusy||quotaExceededMessage}
className="text-slate-500 hover:text-indigo-600 text-sm underline mt-2"
>
{isBusy&&progressMsg.includes("test")?"Testing...":"Test Drive Connection (Send Sample)"}
</button>
</div>
)}
</div>
</section>
)}

{quotaExceededMessage&&(
<div className="fixed bottom-6 right-6 bg-yellow-100 border-2 border-yellow-400 text-yellow-800 px-6 py-4 rounded-xl shadow-xl max-w-sm z-50 animate-bounce-in">
<div className="font-bold text-lg mb-2">API Quota Exceeded</div>
<p className="text-sm mb-4">You've hit the usage limit for a Gemini API. A paid API key is required for this operation.</p>
<button
onClick={handleSelectApiKey}
className="w-full bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded-full transition active:scale-95 text-base shadow-md"
>
Select / Configure API Key
</button>
<p className="text-xs text-yellow-700 underline mt-3">
<a href="https://ai.google.dev/gemini-api/docs/billing"target="_blank"rel="noopener noreferrer">Learn more about billing.</a>
</p>
<button
onClick={()=>setQuotaExceededMessage(false)}
className="absolute top-2 right-2 text-yellow-600 hover:text-yellow-800 text-xl"
>✕</button>
</div>
)}

{errorMessage&&(
<div className="fixed bottom-6 right-6 bg-red-100 border-2 border-red-400 text-red-800 px-6 py-4 rounded-xl shadow-xl max-w-sm z-50 animate-bounce-in">
<div className="font-bold text-lg mb-2">Error</div>
<p className="text-sm">{errorMessage}</p>
<button
onClick={()=>setErrorMessage('')}
className="absolute top-2 right-2 text-red-600 hover:text-red-800 text-xl"
>✕</button>
</div>
)}

{successMessage&&(
<div className="fixed bottom-6 right-6 bg-green-100 border-2 border-green-400 text-green-800 px-6 py-4 rounded-xl shadow-xl max-w-sm z-50 animate-bounce-in">
<div className="font-bold text-lg mb-2">Success</div>
<p className="text-sm">{successMessage}</p>
<button
onClick={()=>setSuccessMessage('')}
className="absolute top-2 right-2 text-green-600 hover:text-green-800 text-xl"
>✕</button>
</div>
)}

<div className="mt-10 pt-6 border-t border-slate-200 text-center">
<p className="text-sm text-slate-500">Monetiza Studio v20.0</p>
</div>
</main>
</div>
);
};

export default App;