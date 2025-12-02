declare global{
  interface AIStudio{
    hasSelectedApiKey:()=>Promise<boolean>;
    openSelectKey:()=>Promise<void>;
  }
  interface Window{
    aistudio?:AIStudio;
    webkitAudioContext?:typeof AudioContext;
  }
}
export interface LiturgyData{
  evangelho:string;
  texto_evangelho:string;
  referencia_liturgica:string;
  primeira_leitura:string;
  salmo:string;
  segunda_leitura:string;
  [key:string]:string;
}
export interface ScriptBlock{
  text:string;
  prompt:string;
}
export interface Roteiro{
  hook?:ScriptBlock;
  leitura:ScriptBlock;
  reflexao?:ScriptBlock;
  aplicacao?:ScriptBlock;
  oracao?:ScriptBlock;
}
export type AssetType='image'|'audio'|'srt';
export interface GeneratedAsset{
  block_id:string;
  type:AssetType;
  data_b64:string;
}
export interface JobPayload{
  assets:GeneratedAsset[];
  roteiro:Roteiro;
  meta_dados:{data:string;ref:string;};
  leitura_montada:string;
}
export enum VisualStyle{
  Cinematic="Cinematic Realistic",
  OilPainting="Oil Painting",
  Watercolor="Watercolor",
  Anime="Anime Style",
  DigitalArt="Digital Art",
}
export enum ImageModel{
  Flash="gemini-2.5-flash-image",
  Pro="gemini-3-pro-image-preview",
}
export enum VoiceOption{
  Kore="Kore",
  Alnilam="Alnilam",
  Puck="Puck",
  Charon="Charon",
  Fenrir="Fenrir"
}
export enum IntroStyle{
  Viral="Viral (Hook + Curiosity)",
  Liturgical="Liturgical (Traditional)"
}
export enum ProcessingState{
  Idle,
  FetchingLiturgy,
  GeneratingScript,
  GeneratingMedia,
  Uploading,
  Complete,
  Error
}