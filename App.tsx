import React, { useState, useEffect, useRef } from 'react';
import { LiturgyData, Roteiro, VisualStyle, VoiceOption, IntroStyle, ProcessingState, GeneratedAsset, JobPayload, ScriptBlock, ImageModel } from './types';
import * as gasService from './services/gasService';
import * as geminiService from './services/geminiService';
import * as utils from './utils';
import BlockCard from './components/BlockCard';
import { logger } from './services/logger';

// Tipos auxiliares para o estado de produção
// NOTE: image and audio here store Blob URLs (blob:http://...) for performance, not Base64
type AssetMap = Record<string, { image?: string; audio?: string }>;
type BlockStatus = 'pending' | 'generating_audio' | 'generating_image' | 'done' | 'error';

const App: React.FC = () => {
  // --- STATE DE NAVEGAÇÃO E DADOS ---
  const [activeTab, setActiveTab] = useState<'dashboard' | 'manual'>('dashboard');
  
  // Novo estado para controle de visualização no mobile
  const [mobileView, setMobileView] = useState<'jobs' | 'editor'>('jobs');

  const [driveJobs, setDriveJobs] = useState<gasService.DriveJob[]>([]);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [roteiro, setRoteiro] = useState<Roteiro | null>(null);
  const [metaDados, setMetaDados] = useState<{data: string, ref: string}>({data: '', ref: ''});

  // --- CONFIGURAÇÕES ---
  const [visualStyle, setVisualStyle] = useState<VisualStyle>(VisualStyle.Cinematic);
  const [imageModel, setImageModel] = useState<ImageModel>(ImageModel.Flash);
  const [audioVoice, setAudioVoice] = useState<VoiceOption>(VoiceOption.Alnilam);
  const [videoResolution, setVideoResolution] = useState('9:16 (Vertical/Stories)');

  // --- STATE DE PRODUÇÃO ---
  const [assets, setAssets] = useState<AssetMap>({});
  const [blockStatus, setBlockStatus] = useState<Record<string, BlockStatus>>({});
  const [progress, setProgress] = useState({ percent: 0, done: 0, total: 0 });
  const [eta, setEta] = useState<string>('--:--');
  const startTimeRef = useRef<number>(0);
  
  // --- STATE DE MENSAGENS ---
  const [processingState, setProcessingState] = useState<ProcessingState>(ProcessingState.Idle);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    logger.info('App initialized');
    if (activeTab === 'dashboard') refreshJobList();
  }, [activeTab]);

  const refreshJobList = async () => {
    setProcessingState(ProcessingState.FetchingLiturgy);
    const jobs = await gasService.listJobs();
    setDriveJobs(jobs);
    setProcessingState(ProcessingState.Idle);
  };

  const handleLoadJob = async (job: gasService.DriveJob) => {
    setProcessingState(ProcessingState.FetchingLiturgy);
    try {
      const payload = await gasService.fetchJob(job.id);
      if (payload && payload.roteiro) {
        setRoteiro(payload.roteiro);
        setMetaDados(payload.meta_dados || { data: 'Unknown', ref: 'Unknown' });
        setCurrentJobId(job.id);
        // Limpa assets anteriores ao carregar novo job
        setAssets({});
        setBlockStatus({});
        setProgress({ percent: 0, done: 0, total: 0 });
        setEta('--:--');
        setSuccessMessage(`Roteiro carregado: ${payload.meta_dados.ref}`);
        setErrorMessage('');
        
        // No mobile, troca para a view de editor automaticamente
        setMobileView('editor');
      } else {
        setErrorMessage("Dados do job inválidos.");
      }
    } catch (e: any) {
      setErrorMessage("Falha ao carregar job: " + e.message);
    }
    setProcessingState(ProcessingState.Idle);
  };

  const updateRoteiroBlock = (blockId: string, data: ScriptBlock) => {
    if (!roteiro) return;
    setRoteiro(prev => prev ? ({ ...prev, [blockId]: data }) : null);
  };

  // --- FUNÇÕES DE PRODUÇÃO E MANIPULAÇÃO DE ASSETS ---

  const calculateETA = (completed: number, total: number) => {
    if (completed === 0) return 'Calculando...';
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    const rate = elapsed / completed;
    const remaining = (total - completed) * rate;
    return `${Math.ceil(remaining)}s`;
  };

  // 1. GERAÇÃO EM LOTE (PREVIEW)
  const handleGeneratePreview = async () => {
    if (!roteiro) return;
    if (!window.aistudio || !(await window.aistudio.hasSelectedApiKey())) {
      setErrorMessage("Configure sua API Key primeiro.");
      return;
    }

    setProcessingState(ProcessingState.GeneratingMedia);
    setErrorMessage('');
    setSuccessMessage('');
    startTimeRef.current = Date.now();

    const blocksToProcess = ['hook', 'leitura', 'reflexao', 'aplicacao', 'oracao'] as const;
    const totalTasks = blocksToProcess.length * 2;
    let tasksDone = 0;

    const initialStatus: Record<string, BlockStatus> = {};
    blocksToProcess.forEach(b => initialStatus[b] = 'pending');
    setBlockStatus(initialStatus);
    setProgress({ percent: 0, done: 0, total: totalTasks });

    for (const blockId of blocksToProcess) {
      const blockData = roteiro[blockId];
      if (!blockData || !blockData.text) {
        tasksDone += 2;
        continue;
      }

      // --- GERAÇÃO DE ÁUDIO ---
      setBlockStatus(prev => ({ ...prev, [blockId]: 'generating_audio' }));
      try {
        if (!assets[blockId]?.audio) {
          const pcmB64 = await geminiService.generateSpeech(blockData.text, audioVoice);
          const wavBytes = utils.pcmToWav(utils.decode(pcmB64), 24000, 1, 16);
          const audioB64 = utils.encode(wavBytes);
          
          // CONVERT TO BLOB URL FOR PERFORMANCE
          const audioBlob = utils.base64ToBlob(audioB64, 'audio/wav');
          const audioUrl = URL.createObjectURL(audioBlob);

          setAssets(prev => ({ ...prev, [blockId]: { ...prev[blockId], audio: audioUrl } }));
        }
      } catch (e) {
        logger.error(`Erro áudio ${blockId}`, e);
        setErrorMessage(`Falha no áudio do ${blockId}`);
      }
      tasksDone++;
      updateProgress(tasksDone, totalTasks);

      // --- GERAÇÃO DE IMAGEM ---
      setBlockStatus(prev => ({ ...prev, [blockId]: 'generating_image' }));
      try {
        if (!assets[blockId]?.image) {
          const prompt = blockData.prompt || `Cena católica para ${blockId}`;
          const aspectRatio = videoResolution.includes("9:16") ? "9:16" : videoResolution.includes("16:9") ? "16:9" : "1:1";
          const imgB64 = await geminiService.generateImage(prompt, visualStyle, aspectRatio, imageModel);
          
          // CONVERT TO BLOB URL FOR PERFORMANCE
          const imgBlob = utils.base64ToBlob(imgB64, 'image/png');
          const imgUrl = URL.createObjectURL(imgBlob);

          setAssets(prev => ({ ...prev, [blockId]: { ...prev[blockId], image: imgUrl } }));
        }
      } catch (e) {
        logger.error(`Erro imagem ${blockId}`, e);
        setErrorMessage(`Falha na imagem do ${blockId}`);
      }
      tasksDone++;
      updateProgress(tasksDone, totalTasks);

      setBlockStatus(prev => ({ ...prev, [blockId]: 'done' }));
    }

    setProcessingState(ProcessingState.Idle);
    setSuccessMessage("Mídias geradas! Revise e clique em Enviar.");
  };

  const updateProgress = (done: number, total: number) => {
    setProgress({ percent: Math.round((done / total) * 100), done, total });
    setEta(calculateETA(done, total));
  };

  // 2. REGENERAR IMAGEM ÚNICA
  const handleRegenerateSingleImage = async (blockId: string) => {
    if (!roteiro) return;
    setBlockStatus(prev => ({ ...prev, [blockId]: 'generating_image' }));
    try {
      const blockData = roteiro[blockId as keyof Roteiro];
      const prompt = blockData?.prompt || "Cena católica";
      const aspectRatio = videoResolution.includes("9:16") ? "9:16" : "1:1";
      const imgB64 = await geminiService.generateImage(prompt, visualStyle, aspectRatio, imageModel);
      
      const imgBlob = utils.base64ToBlob(imgB64, 'image/png');
      const imgUrl = URL.createObjectURL(imgBlob);

      setAssets(prev => ({ ...prev, [blockId]: { ...prev[blockId], image: imgUrl } }));
      setBlockStatus(prev => ({ ...prev, [blockId]: 'done' }));
    } catch (e: any) {
      setErrorMessage(`Erro ao regenerar imagem: ${e.message}`);
      setBlockStatus(prev => ({ ...prev, [blockId]: 'error' }));
    }
  };

  // 3. REGENERAR ÁUDIO ÚNICO (NOVO)
  const handleRegenerateSingleAudio = async (blockId: string) => {
    if (!roteiro) return;
    setBlockStatus(prev => ({ ...prev, [blockId]: 'generating_audio' }));
    try {
      const blockData = roteiro[blockId as keyof Roteiro];
      if (!blockData?.text) return;
      
      const pcmB64 = await geminiService.generateSpeech(blockData.text, audioVoice);
      const wavBytes = utils.pcmToWav(utils.decode(pcmB64), 24000, 1, 16);
      const audioB64 = utils.encode(wavBytes);
      
      const audioBlob = utils.base64ToBlob(audioB64, 'audio/wav');
      const audioUrl = URL.createObjectURL(audioBlob);
      
      setAssets(prev => ({ ...prev, [blockId]: { ...prev[blockId], audio: audioUrl } }));
      setBlockStatus(prev => ({ ...prev, [blockId]: 'done' }));
    } catch (e: any) {
      setErrorMessage(`Erro ao regenerar áudio: ${e.message}`);
      setBlockStatus(prev => ({ ...prev, [blockId]: 'error' }));
    }
  };

  // 4. UPLOAD MANUAL DE IMAGEM
  const handleUploadReplacement = (blockId: string, file: File) => {
    const url = URL.createObjectURL(file);
    setAssets(prev => ({ ...prev, [blockId]: { ...prev[blockId], image: url } }));
  };

  // 5. UPLOAD MANUAL DE ÁUDIO (NOVO)
  const handleUploadAudioReplacement = (blockId: string, file: File) => {
    const url = URL.createObjectURL(file);
    setAssets(prev => ({ ...prev, [blockId]: { ...prev[blockId], audio: url } }));
  };

  // 6. ENVIO FINAL
  const handleFinalUpload = async () => {
    if (!roteiro) return;
    setProcessingState(ProcessingState.Uploading);
    setErrorMessage('');

    try {
      const finalAssets: GeneratedAsset[] = [];
      const keys = Object.keys(assets);
      
      for (const bid of keys) {
        const media = assets[bid];
        
        // Convert Blob URLs back to Base64 for upload
        if (media.image) {
            let b64 = media.image;
            if (b64.startsWith('blob:')) {
                b64 = await utils.blobUrlToBase64(media.image);
            }
            finalAssets.push({ block_id: bid, type: 'image', data_b64: b64 });
        }
        
        if (media.audio) {
            let b64 = media.audio;
             if (b64.startsWith('blob:')) {
                b64 = await utils.blobUrlToBase64(media.audio);
            }
            finalAssets.push({ block_id: bid, type: 'audio', data_b64: b64 });
        }
      }

      // Gera SRT na hora do envio (precisa do blob url para duration)
      // Note: getAudioDuration now handles blob urls
      const textMap = utils.mapRoteiroToTextMap(roteiro);
      const srt = await utils.generateSRT(finalAssets, textMap);
      finalAssets.push({ block_id: 'legendas', type: 'srt', data_b64: srt });

      const payload: JobPayload = {
        assets: finalAssets,
        roteiro,
        meta_dados: metaDados,
        leitura_montada: roteiro.leitura.text
      };

      await gasService.sendJobToGAS(payload, currentJobId || undefined);
      
      setSuccessMessage("✅ Job enviado com sucesso para o Drive!");
      setProcessingState(ProcessingState.Complete);
      refreshJobList();
      
      // Revoke URLs to free memory
      Object.values(assets).forEach((a: { image?: string; audio?: string }) => {
        if (a.image?.startsWith('blob:')) URL.revokeObjectURL(a.image);
        if (a.audio?.startsWith('blob:')) URL.revokeObjectURL(a.audio);
      });

      setTimeout(() => {
        setRoteiro(null);
        setAssets({});
        setProcessingState(ProcessingState.Idle);
      }, 2000);

    } catch (e: any) {
      setErrorMessage(`Erro no envio: ${e.message}`);
      setProcessingState(ProcessingState.Error);
    }
  };

  const isBusy = processingState === ProcessingState.GeneratingMedia || processingState === ProcessingState.Uploading;

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center p-4 md:p-6 text-slate-800 font-sans">
      <header className="w-full max-w-6xl flex justify-between items-center mb-4 md:mb-6 bg-white p-3 md:p-4 rounded-xl md:rounded-2xl shadow-sm border border-slate-200">
        <h1 className="text-lg md:text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600 flex items-center gap-2">
          <span>🎨</span> Monetiza Studio
        </h1>
        <div className="flex gap-2">
          <button onClick={() => { setActiveTab('dashboard'); refreshJobList(); }} className="hidden md:block px-4 py-2 rounded-lg text-sm font-semibold text-slate-500 hover:bg-slate-100 transition">Atualizar</button>
          <button onClick={() => window.aistudio?.openSelectKey()} className="px-3 py-1.5 md:px-4 md:py-2 rounded-lg text-xs md:text-sm font-semibold border border-amber-200 text-amber-600 hover:bg-amber-50">🔑 API</button>
        </div>
      </header>

      {/* MOBILE NAVIGATION TABS */}
      <div className="w-full max-w-6xl md:hidden flex mb-4 bg-white rounded-xl shadow-sm border border-slate-200 p-1">
        <button 
          onClick={() => setMobileView('jobs')}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition ${mobileView === 'jobs' ? 'bg-indigo-100 text-indigo-700 shadow-sm' : 'text-slate-500'}`}
        >
          📂 Jobs
        </button>
        <button 
          onClick={() => setMobileView('editor')}
          className={`flex-1 py-2 text-sm font-semibold rounded-lg transition ${mobileView === 'editor' ? 'bg-indigo-100 text-indigo-700 shadow-sm' : 'text-slate-500'}`}
        >
          🎬 Editor
        </button>
      </div>

      <main className="w-full max-w-6xl flex flex-col md:flex-row gap-4 md:gap-6 items-start h-[calc(100vh-140px)] md:h-[calc(100vh-140px)]">
        
        {/* SIDEBAR JOBS - Condicional no Mobile */}
        <aside className={`w-full md:w-1/3 bg-white rounded-2xl shadow-sm border border-slate-200 h-full flex-col overflow-hidden ${mobileView === 'jobs' ? 'flex' : 'hidden md:flex'}`}>
          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
            <h2 className="font-bold text-slate-700">Jobs Pendentes</h2>
            <button onClick={refreshJobList} className="text-indigo-600 hover:bg-indigo-50 p-1 rounded">↻</button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
            {driveJobs.length === 0 && <div className="text-center py-10 text-slate-400 text-sm">Sem jobs pendentes.</div>}
            {driveJobs.map(job => (
              <div key={job.id} onClick={() => !isBusy && handleLoadJob(job)}
                   className={`p-3 rounded-xl border cursor-pointer transition ${currentJobId===job.id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300 bg-white'}`}>
                <div className="flex justify-between"><span className="font-bold text-slate-700">{job.display_date}</span><span className="text-[10px] text-slate-400 bg-slate-100 px-1 rounded">{job.id.slice(0,4)}</span></div>
                <div className="text-xs text-indigo-600 mt-1 truncate">{job.display_ref}</div>
              </div>
            ))}
          </div>
        </aside>

        {/* ÁREA DE PRODUÇÃO - Condicional no Mobile */}
        <section className={`w-full md:w-2/3 bg-white rounded-2xl shadow-sm border border-slate-200 h-full flex-col overflow-hidden ${mobileView === 'editor' ? 'flex' : 'hidden md:flex'}`}>
          
          {/* BARRA DE CONFIG E PROGRESSO */}
          <div className="p-3 md:p-4 border-b border-slate-100 bg-slate-50 space-y-4">
             <div className="flex gap-2 flex-wrap">
               <select disabled={isBusy} value={imageModel} onChange={e => setImageModel(e.target.value as any)} className="flex-1 md:flex-none px-2 py-2 text-xs border rounded-lg bg-white shadow-sm outline-none focus:ring-1 focus:ring-indigo-500"><option value={ImageModel.Flash}>Gemini Flash (Rápido)</option><option value={ImageModel.Pro}>Gemini Pro (Top)</option></select>
               <select disabled={isBusy} value={videoResolution} onChange={e => setVideoResolution(e.target.value)} className="flex-1 md:flex-none px-2 py-2 text-xs border rounded-lg bg-white shadow-sm outline-none focus:ring-1 focus:ring-indigo-500"><option>9:16 (Stories)</option><option>16:9 (YouTube)</option></select>
               <select disabled={isBusy} value={audioVoice} onChange={e => setAudioVoice(e.target.value as any)} className="flex-1 md:flex-none px-2 py-2 text-xs border rounded-lg bg-white shadow-sm outline-none focus:ring-1 focus:ring-indigo-500">{Object.values(VoiceOption).map(v => <option key={v} value={v}>{v}</option>)}</select>
             </div>

             {(processingState === ProcessingState.GeneratingMedia || progress.percent > 0) && (
               <div className="w-full bg-slate-200 rounded-full h-4 relative overflow-hidden">
                 <div className="bg-gradient-to-r from-indigo-500 to-purple-500 h-full transition-all duration-500" style={{ width: `${progress.percent}%` }}></div>
                 <div className="absolute top-0 left-0 w-full h-full flex justify-between px-3 items-center text-[10px] font-bold text-slate-600 mix-blend-multiply">
                    <span>{progress.percent}% Concluído</span>
                    <span>ETA: {eta}</span>
                 </div>
               </div>
             )}
          </div>

          {/* MENSAGENS */}
          {(errorMessage || successMessage) && (
            <div className={`px-4 py-2 text-sm text-center ${errorMessage ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
              {errorMessage || successMessage}
            </div>
          )}

          {/* CONTEÚDO PRINCIPAL (PREVIEW) */}
          <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50/50 custom-scrollbar">
            {!roteiro ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-300">
                <div className="text-5xl mb-2">🎬</div>
                <p>Selecione um job na lista.</p>
              </div>
            ) : (
              <div className="space-y-6 pb-20 md:pb-0">
                <div className="flex flex-col md:flex-row md:justify-between md:items-end border-b pb-2 gap-1">
                  <h2 className="text-lg md:text-xl font-bold text-slate-800 leading-tight">{metaDados.ref}</h2>
                  <span className="text-xs text-slate-500">{metaDados.data}</span>
                </div>

                {['hook', 'leitura', 'reflexao', 'aplicacao', 'oracao'].map((blockId) => {
                  const block = roteiro[blockId as keyof Roteiro];
                  if (!block?.text) return null;
                  const status = blockStatus[blockId] || 'pending';
                  const media = assets[blockId] || {};

                  return (
                    <div key={blockId} className={`bg-white border rounded-xl p-3 md:p-4 shadow-sm transition-all ${status.includes('generating') ? 'ring-2 ring-indigo-100 border-indigo-200' : 'border-slate-200'}`}>
                      {/* Cabeçalho do Bloco */}
                      <div className="flex justify-between items-center mb-3">
                        <div className="flex items-center gap-2">
                          <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-xs font-bold uppercase">{blockId}</span>
                          {status === 'generating_audio' && <span className="text-xs text-indigo-500 animate-pulse">🎤 Áudio...</span>}
                          {status === 'generating_image' && <span className="text-xs text-purple-500 animate-pulse">🎨 Imagem...</span>}
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-4">
                        {/* Texto e Audio */}
                        <div className="flex-1 flex flex-col gap-2">
                          <BlockCard 
                            title="" 
                            color="quaternary" 
                            blockData={block} 
                            onBlockDataChange={(newData) => updateRoteiroBlock(blockId, newData)} 
                            readOnly={isBusy}
                          />
                          
                          <div className="flex items-center gap-2 mt-2">
                            {media.audio ? (
                              <audio controls src={media.audio} className="w-full h-8" />
                            ) : (
                              <div className="flex-1 h-8 bg-slate-100 rounded flex items-center justify-center text-xs text-slate-400">
                                {status === 'generating_audio' ? 'Gerando...' : 'Aguardando Áudio...'}
                              </div>
                            )}
                            
                            {/* CONTROLES DE ÁUDIO */}
                            {!isBusy && (
                                <div className="flex gap-1 shrink-0">
                                    <button 
                                        onClick={() => handleRegenerateSingleAudio(blockId)}
                                        title="Regenerar Áudio"
                                        className="p-1.5 bg-indigo-50 text-indigo-600 rounded hover:bg-indigo-100 transition"
                                    >
                                        🔄
                                    </button>
                                    <label className="cursor-pointer p-1.5 bg-indigo-50 text-indigo-600 rounded hover:bg-indigo-100 transition" title="Upload Áudio">
                                        📤
                                        <input type="file" accept="audio/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleUploadAudioReplacement(blockId, e.target.files[0])} />
                                    </label>
                                </div>
                            )}
                          </div>
                        </div>

                        {/* Imagem e Controles */}
                        <div className="w-full sm:w-48 flex flex-col gap-2">
                          <div className="aspect-[9/16] bg-slate-200 rounded-lg overflow-hidden relative group border border-slate-300">
                            {media.image ? (
                              <img src={media.image} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">
                                  {status === 'generating_image' ? 'Gerando...' : 'Imagem...'}
                              </div>
                            )}
                            
                            {/* Overlay de Ações na Imagem */}
                            {media.image && !isBusy && (
                              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                                <button 
                                  onClick={() => handleRegenerateSingleImage(blockId)}
                                  className="bg-white/20 hover:bg-white/40 text-white text-xs px-3 py-1 rounded-full backdrop-blur-sm transition"
                                >
                                  🔄 Regenerar
                                </button>
                                <label className="cursor-pointer bg-white/20 hover:bg-white/40 text-white text-xs px-3 py-1 rounded-full backdrop-blur-sm transition">
                                  📤 Upload
                                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleUploadReplacement(blockId, e.target.files[0])} />
                                </label>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* RODAPÉ DE AÇÃO */}
          <div className="p-4 border-t border-slate-200 bg-white flex flex-col md:flex-row justify-end gap-3 sticky bottom-0 z-10 md:relative md:z-auto shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] md:shadow-none">
            <button 
              onClick={handleGeneratePreview}
              disabled={isBusy || !roteiro}
              className="w-full md:w-auto px-6 py-3 rounded-xl font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition disabled:opacity-50 text-sm md:text-base"
            >
              {Object.keys(assets).length > 0 ? "🔄 Regerar Tudo" : "🎬 1. Gerar Mídias"}
            </button>
            
            {Object.keys(assets).length > 0 && (
              <button 
                onClick={handleFinalUpload}
                disabled={isBusy}
                className="w-full md:w-auto px-6 py-3 rounded-xl font-bold text-white bg-green-600 hover:bg-green-700 shadow-lg transition transform active:scale-95 disabled:opacity-50 text-sm md:text-base"
              >
                ☁️ 2. Enviar
              </button>
            )}
          </div>

        </section>
      </main>
    </div>
  );
};

export default App;