import React, { useState, useEffect } from 'react';
import { LiturgyData, Roteiro, VisualStyle, VoiceOption, IntroStyle, ProcessingState, GeneratedAsset, JobPayload, AIStudio, ScriptBlock } from './types';
import * as gasService from './services/gasService';
import * as geminiService from './services/geminiService';
import * as liturgyService from './services/liturgyService';
import * as utils from './utils';
import BlockCard from './components/BlockCard';
import { logger } from './services/logger';
import { LogEntry } from './services/logger'; // Import LogEntry type

// --- Code Snippets for Viewer ---
const gasCode = `// Code.gs (no seu projeto do Google Apps Script)

// Função para lidar com requisições POST
function doPost(e) {
  try {
    console.log('PostData Type:', e.postData.type);
    console.log('PostData Contents (raw):', e.postData.contents);

    var requestBody = JSON.parse(e.postData.contents);
    console.log('JSON Parsed:', requestBody);

    var action = e.parameter.action;

    if (action === 'generate_job') {
      var folderName = 'Monetiza_Studio_Jobs';
      var rootFolder = DriveApp.getRootFolder();
      
      var folders = rootFolder.getFoldersByName(folderName);
      var folder;
      if (folders.hasNext()) {
        folder = folders.next();
        console.log('Pasta existente encontrada:', folderName);
      } else {
        folder = rootFolder.createFolder(folderName);
        console.log('Nova pasta criada:', folderName);
      }
      
      var jobId = 'JOB-' + Utilities.getUuid();
      var fileName = 'job_data_' + jobId + '.json';
      var fileContent = JSON.stringify(requestBody, null, 2);
      
      // Removido o MimeType.JSON. O Drive inferirá o tipo pela extensão .json
      folder.createFile(fileName, fileContent); 

      console.log('Arquivo criado no Drive:', fileName, 'na pasta:', folderName);

      return ContentService.createTextOutput(JSON.stringify({ status: 'success', job_id: jobId }))
        .setMimeType(ContentService.MimeType.JSON);

    } else {
      console.warn('Ação não reconhecida solicitada:', action);
      return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Ação não reconhecida: ' + action }))
        .setMimeType(ContentService.MimeType.JSON);
    }

  } catch (error) {
    console.error('Erro no doPost:', error.message, error.stack);
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.message || 'Erro interno do servidor GAS', details: error.stack }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  console.log('doGet chamado com parâmetros:', e.parameter);
  return ContentService.createTextOutput(JSON.stringify({ status: 'info', message: 'Endpoint GET ativo para o Monetiza Studio.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doOptions() {
  console.log('doOptions chamado (pré-verificação CORS)');
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT)
    .addOtherHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
}`;

const pythonAppCode = `# app.py — Studio Jhonata (COMPLETO v20.0 - COM INTEGRAÇÃO DRIVE)
# Features: Música Persistente, Geração em Lote, Fix NameError, Transições, Overlay, Efeitos, Carregamento via Drive
import os
import re
import json
import time
import tempfile
import traceback
import subprocess
import urllib.parse
import random
from io import BytesIO
from datetime import date
from typing import List, Optional, Tuple, Dict, Any
import base64
import shutil as _shutil # Import for rmtree

import requests
from PIL import Image, ImageDraw, ImageFont
import streamlit as st

# --- Google Drive API Imports ---
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# Force ffmpeg path for imageio if needed (Streamlit Cloud)
os.environ.setdefault("IMAGEIO_FFMPEG_EXE", "/usr/bin/ffmpeg")

# Arquivos de configuração persistentes
CONFIG_FILE = "overlay_config.json"
SAVED_MUSIC_FILE = "saved_bg_music.mp3"
MONETIZA_DRIVE_FOLDER_NAME = "Monetiza_Studio_Jobs"

# =========================
# Page config
# =========================
st.set_page_config(
    page_title="Studio Jhonata",
    layout="wide",
    initial_sidebar_state="expanded",
)

# =========================
# Persistência de Configurações e Arquivos
# =========================
def load_config():
    """Carrega configurações do disco ou retorna padrão"""
    default_settings = {
        "line1_y": 40, "line1_size": 40, "line1_font": "Padrão (Sans)", "line1_anim": "Estático",
        "line2_y": 90, "line2_size": 28, "line2_font": "Padrão (Sans)", "line2_anim": "Estático",
        "line3_y": 130, "line3_size": 24, "line3_font": "Padrão (Sans)", "line3_anim": "Estático",
        "effect_type": "Zoom In (Ken Burns)", "effect_speed": 3,
        "trans_type": "Fade (Escurecer)", "trans_dur": 0.5,
        "music_vol": 0.15
    }
    
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                saved = json.load(f)
                default_settings.update(saved)
                return default_settings
        except Exception as e:
            st.warning(f"Erro ao carregar configurações salvas: {e}")
    
    return default_settings

def save_config(settings):
    """Salva configurações no disco"""
    try:
        with open(CONFIG_FILE, "w") as f:
            json.dump(settings, f)
        return True
    except Exception as e:
        st.error(f"Erro ao salvar configurações: {e}")
        return False

def save_music_file(file_bytes):
    """Salva a música padrão no disco"""
    try:
        with open(SAVED_MUSIC_FILE, "wb") as f:
            f.write(file_bytes)
        return True
    except Exception as e:
        st.error(f"Erro ao salvar música: {e}")
        return False

def delete_music_file():
    """Remove a música padrão"""
    try:
        if os.path.exists(SAVED_MUSIC_FILE):
            os.remove(SAVED_MUSIC_FILE)
        return True
    except Exception as e:
        st.error(f"Erro ao deletar música: {e}")
        return False

# =========================
# Groq - lazy init
# =========================
_groq_client = None

def inicializar_groq():
    global _groq_client
    if _groq_client is None:
        try:
            from groq import Groq  # type: ignore

            if "GROQ_API_KEY" not in st.secrets and not os.getenv("GROQ_API_KEY"):
                st.error("❌ Configure GROQ_API_KEY em Settings → Secrets no Streamlit Cloud.")
                st.stop()
            api_key = st.secrets.get("GROQ_API_KEY") or os.getenv("GROQ_API_KEY")
            _groq_client = Groq(api_key=api_key)
        except Exception as e:
            st.error(f"Erro ao inicializar Groq client: {e}")
            st.stop()
    return _groq_client

# =========================
# Google Drive API Client - lazy init
# =========================
_drive_service = None

def get_drive_service():
    global _drive_service
    if _drive_service is None:
        try {
            # st.secrets["gcp_service_account"] should contain the JSON key file
            # in a format like: {"type": "service_account", "project_id": "...", ...}
            creds_json = st.secrets.get("gcp_service_account");
            if not creds_json:
                st.error("❌ Configure 'gcp_service_account' em Settings → Secrets no Streamlit Cloud.");
                st.stop();

            creds = service_account.Credentials.from_service_account_info(
                creds_json,
                scopes=['https://www.googleapis.com/auth/drive.readonly'] # Read-only scope is sufficient
            );
            _drive_service = build('drive', 'v3', credentials=creds);
            st.success("✅ Google Drive API inicializada com sucesso!");
        } catch (Exception as e) {
            st.error(f"❌ Erro ao inicializar Google Drive API: {e}. Verifique as credenciais da conta de serviço e permissões.");
            st.stop();
        }
    }
    return _drive_service;
}

// =========================
// Inicializar banco de personagens
// =========================
@st.cache_data
def inicializar_personagens():
    return {
        "Jesus": (
            "homem de 33 anos, pele morena clara, cabelo castanho ondulado na altura dos ombros, "
            "barba bem aparada, olhos castanhos penetrantes e serenos, túnica branca tradicional "
            "com detalhes vermelhos, manto azul, expressão de autoridade amorosa, estilo renascentista clássico"
        ),
        "São Pedro": (
            "homem robusto de 50 anos, pele bronzeada, cabelo curto grisalho, barba espessa, olhos "
            "determinados, túnica de pescador bege com remendos, mãos calejadas, postura forte, estilo realista bíblico"
        ),
        "São João": (
            "jovem de 25 anos, magro, cabelo castanho longo liso, barba rala, olhos expressivos, túnica "
            "branca limpa, expressão contemplativa, estilo renascentista"
        ),
    }

// =========================
// Limpeza do texto bíblico
// =========================
def limpar_texto_evangelho(texto: str) -> str:
    if not texto:
        return ""
    texto_limpo = texto.replace("\n", " ").strip()
    texto_limpo = re.sub(r"\b(\d{1,3})(?=[A-Za-zÁ-Úá-ú])", "", texto_limpo)
    texto_limpo = re.sub(r"\s{2,}", " ", texto_limpo)
    return texto_limpo.strip()

// =========================
// Extrair referência bíblica (ROBUSTO)
// =========================
def extrair_referencia_biblica(titulo: str):
    if not titulo:
        return None
    
    titulo_lower = titulo.lower()
    mapa_nomes = {
        "mateus": "Mateus", "mt": "Mateus",
        "marcos": "Marcos", "mc": "Marcos",
        "lucas": "Lucas", "lc": "Lucas",
        "joão": "João", "joao": "João", "jo": "João"
    }
    
    evangelista_encontrado = None
    for chave, valor in mapa_nomes.items():
        if re.search(rf"\b{chave}\b", titulo_lower):
            evangelista_encontrado = valor
            break
    
    if not evangelista_encontrado:
        m_fallback = re.search(r"(?:São|S\.|Sao|San|St\.?)\s*([A-Za-zÁ-Úá-ú]+)", titulo, re.IGNORECASE)
        if m_fallback:
            nome_cand = m_fallback.group(1).strip()
            if len(nome_cand) > 2:
                evangelista_encontrado = nome_cand
            else:
                return None
        else:
            return None

    m_nums = re.search(r"(\d{1,3})\s*[,:]\s*(\d+(?:[-–]\d+)?)", titulo)
    
    if m_nums:
        capitulo = m_nums.group(1)
        versiculos_raw = m_nums.group(2)
        versiculos = versiculos_raw.replace("-", " a ").replace("–", " a ")
    else:
        return None

    return {"evangelista": evangelista_encontrado, "capitulo": capitulo, "versiculos": versiculos}

def formatar_referencia_curta(ref_biblica):
    if not ref_biblica:
        return ""
    return f"{ref_biblica['evangelista']}, Cap. {ref_biblica['capitulo']}, {ref_biblica['versiculos']}"

// =========================
// APIs Liturgia
// =========================
def buscar_liturgia_api1(data_str: str):
    url = f"https://api-liturgia-diaria.vercel.app/?date={data_str}"
    try {
        resp = requests.get(url, timeout=10);
        resp.raise_for_status();
        dados = resp.json();
        today = dados.get("today", {});
        readings = today.get("readings", {});
        gospel = readings.get("gospel");
        if not gospel:
            return None;
        referencia_liturgica = today.get("entry_title", "").strip() or "Evangelho do dia";
        titulo = (
            gospel.get("head_title", "")
            or gospel.get("title", "")
            or "Evangelho de Jesus Cristo"
        ).strip();
        texto = gospel.get("text", "").strip();
        if not texto:
            return None;
        texto_limpo = limpar_texto_evangelho(texto);
        ref_biblica = extrair_referencia_biblica(titulo);
        return {
            "fonte": "api-liturgia-diaria.vercel.app",
            "titulo": titulo,
            "referencia_liturgica": referencia_liturgica,
            "texto": texto_limpo,
            "ref_biblica": ref_biblica,
        };
    } catch (Exception) {
        return None;
    }
}

def buscar_liturgia_api2(data_str: str):
    url = f"https://liturgia.up.railway.app/v2/{data_str}"
    try {
        resp = requests.get(url, timeout=10);
        resp.raise_for_status();
        dados = resp.json();
        lit = dados.get("liturgia", {});
        ev = lit.get("evangelho") or lit.get("evangelho_do_dia") or {};
        if not ev:
            return None;
        texto = ev.get("texto", "") or ev.get("conteudo", "");
        if not texto:
            return None;
        texto_limpo = limpar_texto_evangelho(texto);
        return {
            "fonte": "liturgia.up.railway.app",
            "titulo": "Evangelho do dia",
            "referencia_liturgica": "Evangelho do dia",
            "texto": texto_limpo,
            "ref_biblica": None,
        };
    } catch (Exception) {
        return None;
    }
}

def obter_evangelho_com_fallback(data_str: str):
    ev = buscar_liturgia_api1(data_str);
    if ev:
        st.info("📡 Usando api-liturgia-diaria.vercel.app");
        return ev;
    ev = buscar_liturgia_api2(data_str);
    if ev:
        st.info("📡 Usando liturgia.up.railway.app");
        return ev;
    st.error("❌ Não foi possível obter o Evangelho");
    return None;
}

// =========================
// Roteiro + Prompts
// =========================
def gerar_roteiro_com_prompts_groq(texto_evangelho: str, referencia_liturgica: str, personagens: dict):
    # This function is retained for the *manual* generation path.
    # When loading from Drive, this is skipped.
    client = inicializar_groq();
    texto_limpo = limpar_texto_evangelho(texto_evangelho);
    personagens_str = json.dumps(personagens, ensure_ascii=False);
    system_prompt = f"""Crie roteiro + 6 prompts visuais CATÓLICOS para vídeo devocional.

PERSONAGENS FIXOS: {personagens_str}

IMPORTANTE:
- 4 PARTES EXATAS: HOOK, REFLEXÃO, APLICAÇÃO, ORAÇÃO
- PROMPT_LEITURA separado (momento da leitura do Evangelho, mais calmo e reverente)
- PROMPT_GERAL para thumbnail
- USE SEMPRE as descrições exatas dos personagens
- Estilo: artístico renascentista católico, luz suave, cores quentes

Formato EXATO:

HOOK: [texto 5-8s]
PROMPT_HOOK: [prompt visual com personagens fixos]

REFLEXÃO: [texto 20-25s]
PROMPT_REFLEXÃO: [prompt visual com personagens fixos]

APLICAÇÃO: [texto 20-25s]
PROMPT_APLICACAO: [prompt visual com personagens fixos]

ORAÇÃO: [texto 20-25s]
PROMPT_ORACAO: [prompt visual com personagens fixos]

PROMPT_LEITURA: [prompt visual específico para a leitura do Evangelho, mais calmo e reverente]

PROMPT_GERAL: [prompt para thumbnail/capa]"""
    try {
        resp = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Evangelho: {referencia_liturgica}\\n\\n{texto_limpo[:2000]}"},
            ],
            temperature=0.7,
            max_tokens=1200,
        );
        texto_gerado = resp.choices[0].message.content;
        partes: dict[str, Any] = {};
        // This part requires careful parsing if Groq output is a single string.
        // For simplicity, and since frontend now generates structured Roteiro,
        // this is a placeholder. If direct Groq generation is primary, this parsing
        // logic needs to extract "HOOK:", "PROMPT_HOOK:", etc.
        st.warning("⚠️ O gerador Groq de roteiro precisa ser adaptado para o novo formato de blocos do frontend.");
        return {
            "hook": {"text": "Texto do Hook Groq", "prompt": "Prompt do Hook Groq"},
            "leitura": {"text": "Texto da Leitura Groq", "prompt": "Prompt da Leitura Groq"},
            "reflexao": {"text": "Texto da Reflexão Groq", "prompt": "Prompt da Reflexão Groq"},
            "aplicacao": {"text": "Texto da Aplicação Groq", "prompt": "Prompt da Aplicação Groq"},
            "oracao": {"text": "Texto da Oração Groq", "prompt": "Prompt da Oração Groq"},
        };
    } catch (Exception as e) {
        st.error(f"❌ Erro Groq: {e}");
        return None;
    }
}

def montar_leitura_com_formula(texto_evangelho: str, ref_biblica):
    if ref_biblica:
        abertura = (
            f"Proclamação do Evangelho de Jesus Cristo, segundo São "
            f"{ref_biblica['evangelista']}, "
            f"Capítulo {ref_biblica['capitulo']}, "
            f"versículos {ref_biblica['versiculos']}. "
            "Glória a vós, Senhor!"
        );
    else:
        abertura = (
            "Proclamação do Evangelho de Jesus Cristo, segundo São Lucas. "
            "Glória a vós, Senhor!"
        );
    fechamento = "Palavra da Salvação. Glória a vós, Senhor!";
    return f"{abertura} {texto_evangelho} {fechamento}";
}

// =========================
// FUNÇÕES DE ÁUDIO & VÍDEO
// =========================

def gerar_audio_gtts(texto: str) -> Optional[BytesIO]:
    if not texto or not texto.strip():
        return None;
    mp3_fp = BytesIO();
    try {
        from gtts import gTTS  # type: ignore
        tts = gTTS(text=texto, lang="pt", slow=False);
        tts.write_to_fp(mp3_fp);
        mp3_fp.seek(0);
        return mp3_fp;
    } catch (Exception as e) {
        raise RuntimeError(f"Erro gTTS: {e}");
    }
}

// =========================
// FUNÇÕES DE IMAGEM
// =========================

def get_resolution_params(choice: str) -> dict:
    if "9:16" in choice:
        return {"w": 720, "h": 1280, "ratio": "9:16"};
    elif "16:9" in choice:
        return {"w": 1280, "h": 720, "ratio": "16:9"};
    else: # 1:1
        return {"w": 1024, "h": 1024, "ratio": "1:1"};
}

def gerar_imagem_pollinations_flux(prompt: str, width: int, height: int) -> BytesIO:
    prompt_clean = prompt.replace("\n", " ").strip()[:800];
    prompt_encoded = urllib.parse.quote(prompt_clean);
    seed = random.randint(0, 999999);
    url = f"https://image.pollinations.ai/prompt/{prompt_encoded}?model=flux&width={width}&height={height}&seed={seed}&nologo=true";
    r = requests.get(url, timeout=40);
    r.raise_for_status();
    bio = BytesIO(r.content);
    bio.seek(0);
    return bio;
}

def gerar_imagem_pollinations_turbo(prompt: str, width: int, height: int) -> BytesIO:
    prompt_clean = prompt.replace("\n", " ").strip()[:800];
    prompt_encoded = urllib.parse.quote(prompt_clean);
    seed = random.randint(0, 999999);
    url = f"https://image.pollinations.ai/prompt/{prompt_encoded}?width={width}&height={height}&seed={seed}&nologo=true";
    r = requests.get(url, timeout=30);
    r.raise_for_status();
    bio = BytesIO(r.content);
    bio.seek(0);
    return bio;
}

def gerar_imagem_google_imagen(prompt: str, ratio: str) -> BytesIO:
    gem_key = st.secrets.get("GEMINI_API_KEY") or os.getenv("GEMINI_API_KEY");
    if not gem_key:
        raise RuntimeError("GEMINI_API_KEY não encontrada.");
    url = f"https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key={gem_key}"; // Corrected model version
    headers = {"Content-Type": "application/json"};
    payload = {
        "instances": [{"prompt": prompt}],
        "parameters": {"sampleCount": 1, "aspectRatio": ratio}
    };
    r = requests.post(url, headers=headers, json=payload, timeout=45);
    r.raise_for_status();
    data = r.json();
    if "predictions" in data and len(data["predictions"]) > 0:
        b64 = data["predictions"][0]["bytesBase64Encoded"];
        bio = BytesIO(base64.b64decode(b64));
        bio.seek(0);
        return bio;
    else:
        raise RuntimeError("Resposta inválida do Google Imagen.");
}

def despachar_geracao_imagem(prompt: str, motor: str, res_choice: str) -> BytesIO:
    params = get_resolution_params(res_choice);
    if motor == "Pollinations Flux (Padrão)":
        return gerar_imagem_pollinations_flux(prompt, params["w"], params["h"]);
    elif motor == "Pollinations Turbo":
        return gerar_imagem_pollinations_turbo(prompt, params["w"], params["h"]);
    elif motor == "Google Imagen":
        return gerar_imagem_google_imagen(prompt, params["ratio"]);
    else:
        return gerar_imagem_pollinations_flux(prompt, params["w"], params["h"]);
}

// =========================
// Google Drive Functions
// =========================
def find_file_in_drive_folder(service, file_name: str, folder_name: str) -> Optional[str]:
    """Busca um arquivo específico dentro de uma pasta no Google Drive."""
    try {
        // 1. Encontrar o ID da pasta "Monetiza_Studio_Jobs"
        query_folder = f"name = '{folder_name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
        folders = service.files().list(q=query_folder, fields="files(id)").execute().get('files', []);
        
        if not folders:
            st.error(f"❌ Pasta '{folder_name}' não encontrada no Drive. Certifique-se de que o frontend já fez o upload de um job.");
            return None;
        
        folder_id = folders[0]['id'];
        st.info(f"✅ Pasta '{folder_name}' encontrada com ID: {folder_id}");

        // 2. Buscar o arquivo JSON dentro da pasta
        query_file = f"name = '{file_name}' and mimeType = 'application/json' and '{folder_id}' in parents and trashed = false";
        files = service.files().list(q=query_file, fields="files(id, name)").execute().get('files', []);

        if files:
            st.info(f"✅ Arquivo '{file_name}' encontrado no Drive.");
            return files[0]['id'];
        else:
            st.warning(f"⚠️ Arquivo '{file_name}' não encontrado na pasta '{folder_name}'.");
            return None;
    } catch (HttpError as error) {
        st.error(f"❌ Erro ao buscar arquivo no Google Drive: {error}");
        return None;
    } catch (Exception as e) {
        st.error(f"❌ Erro inesperado ao buscar arquivo no Google Drive: {e}");
        return None;
    }
}

def download_file_content(service, file_id: str) -> Optional[str]:
    """Baixa o conteúdo de um arquivo do Google Drive."""
    try {
        request = service.files().get_media(fileId=file_id);
        content = request.execute().decode('utf-8');
        st.info(f"✅ Conteúdo do arquivo '{file_id}' baixado com sucesso.");
        return content;
    } catch (HttpError as error) {
        st.error(f"❌ Erro ao baixar conteúdo do arquivo {file_id}: {error}");
        return None;
    } catch (Exception as e) {
        st.error(f"❌ Erro inesperado ao baixar conteúdo: {e}");
        return None;
    }
}

def load_job_from_drive(job_id: str) -> Optional[Dict[str, Any]]:
    """Carrega um job payload completo do Google Drive usando o Job ID."""
    service = get_drive_service();
    if not service:
        return None;

    file_name = f"job_data_{job_id}.json";
    file_id = find_file_in_drive_folder(service, file_name, MONETIZA_DRIVE_FOLDER_NAME);
    
    if file_id:
        json_content = download_file_content(service, file_id);
        if json_content:
            try {
                payload = json.loads(json_content);
                st.success(f"✅ Job '{job_id}' carregado do Google Drive!");
                return payload;
            } catch (json.JSONDecodeError as e) {
                st.error(f"❌ Erro ao decodificar JSON do job: {e}");
                return None;
            }
        else:
            st.error(f"❌ Conteúdo JSON do job '{job_id}' está vazio.");
            return None;
    }
    return None;
}

def process_job_payload_and_update_state(payload: Dict[str, Any], temp_dir: str):
    """
    Processa o payload do job, decodifica assets e atualiza o Streamlit session state.
    Retorna True em caso de sucesso, False em caso de falha.
    """
    try {
        // The frontend now sends 'roteiro' with nested objects like {hook: {text: ..., prompt: ...}}
        st.session_state["roteiro_gerado"] = payload.get("roteiro", {});
        st.session_state["meta_dados"] = payload.get("meta_dados", {"data": "", "ref": ""});

        st.session_state["generated_images_blocks"] = {}; // Stores file paths to temp files
        st.session_state["generated_audios_blocks"] = {}; // Stores file paths to temp files
        st.session_state["generated_srt_content"] = ""; // Stores raw SRT string

        assets = payload.get("assets", []);
        for asset in assets:
            block_id = asset.get("block_id");
            asset_type = asset.get("type");
            data_b64 = asset.get("data_b64");

            if not block_id or not asset_type or not data_b64:
                st.warning(f"⚠️ Asset com dados incompletos, ignorando: {asset}");
                continue;

            decoded_data = base64.b64decode(data_b64);
            
            if asset_type == "image":
                file_path = os.path.join(temp_dir, f"{block_id}.png");
                with open(file_path, "wb") as f:
                    f.write(decoded_data);
                st.session_state["generated_images_blocks"][block_id] = file_path; // Store path
            elif asset_type == "audio":
                file_path = os.path.join(temp_dir, f"{block_id}.mp3");
                with open(file_path, "wb") as f:
                    f.write(decoded_data);
                st.session_state["generated_audios_blocks"][block_id] = file_path; // Store path
            elif asset_type == "srt" and block_id == "legendas":
                srt_content = decoded_data.decode('utf-8');
                st.session_state["generated_srt_content"] = srt_content;
        
        st.success("✅ Assets decodificados e estado atualizado!");
        return True;
    } catch (Exception as e) {
        st.error(f"❌ Erro ao processar payload do job: {e}");
        return False;
    }
}


// =========================
// Helpers
// =========================
def shutil_which(bin_name: str) -> Optional[str]:
    return _shutil.which(bin_name);

def run_cmd(cmd: List[str]):
    try {
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE);
    } catch (subprocess.CalledProcessError as e) {
        stderr = e.stderr.decode("utf-8", errors="replace") if e.stderr else "";
        raise RuntimeError(f"Comando falhou: {' '.join(cmd)}\\nSTDERR: {stderr}");
    }
}

def get_audio_duration_seconds(audio_path: str) -> Optional[float]:
    """Obtém a duração de um áudio a partir do caminho do arquivo."""
    if not shutil_which("ffprobe"):
        st.warning("⚠️ ffprobe não encontrado! A duração do áudio pode ser imprecisa.");
        // Fallback to a default duration if ffprobe is not available
        return 5.0; 
    
    cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", audio_path];
    try {
        p = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE);
        out = p.stdout.decode().strip();
        return float(out) if out else None;
    } catch (Exception) {
        st.error(f"Erro ao obter duração do áudio com ffprobe para {os.path.basename(audio_path)}.");
        return 5.0; // Fallback in case of ffprobe error
    } finally {
        pass; // No need to delete temp file here, handled by rmtree later
    }
}


def resolve_font_path(font_choice: str, uploaded_font: Optional[BytesIO]) -> Optional[str]:
    if font_choice == "Upload Personalizada" and uploaded_font:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".ttf") as tmp:
            tmp.write(uploaded_font.getvalue());
            return tmp.name;
    system_fonts = {
        "Padrão (Sans)": ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", "arial.ttf"],
        "Serif": ["/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf", "times.ttf"],
        "Monospace": ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", "courier.ttf"]
    };
    candidates = system_fonts.get(font_choice, system_fonts["Padrão (Sans)"]);
    for font in candidates:
        if os.path.exists(font): return font;
    return None;
}

def criar_preview_overlay(width: int, height: int, texts: List[Dict], global_upload: Optional[BytesIO]) -> BytesIO:
    img = Image.new("RGB", (width, height), "black");
    draw = ImageDraw.Draw(img);
    for item in texts:
        text = item.get("text", "");
        if not text: continue;
        size = item.get("size", 30);
        y = item.get("y", 0);
        color = item.get("color", "white");
        font_style = item.get("font_style", "Padrão (Sans)");
        font_path = resolve_font_path(font_style, global_upload);
        try {
            if font_path and os.path.exists(font_path):
                font = ImageFont.truetype(font_path, size);
            else:
                font = ImageFont.load_default();
            }
        except {
             font = ImageFont.load_default();
        }
        try {
            length = draw.textlength(text, font=font);
        } except {
             length = len(text) * size * 0.5;
        }
        x = (width - length) / 2;
        draw.text((x, y), text, fill=color, font=font);
    bio = BytesIO();
    img.save(bio, format="PNG");
    bio.seek(0);
    return bio;
}

def get_text_alpha_expr(anim_type: str, duration: float) -> str:
    """Retorna expressão de alpha para o drawtext baseado na animação escolhida"""
    if anim_type == "Fade In":
        // Aparece em 1s
        return f"alpha='min(1,t/1)'";
    elif anim_type == "Fade In/Out":
        // Aparece em 1s, some 1s antes do fim
        // min(1,t/1) * min(1,(dur-t)/1)
        return f"alpha='min(1,t/1)*min(1,({duration}-t)/1)'";
    else: 
        // Estático
        return "alpha=1";
    }

def sanitize_text_for_ffmpeg(text: str) -> str:
    """Limpa texto para evitar quebra do filtro drawtext (vírgulas, dois pontos, aspas)"""
    if not text: return "";
    t = text.replace(":", "\\:");
    t = t.replace("'", ""); 
    return t;
}

// =========================
// Interface principal
// =========================
st.title("✨ Studio Jhonata - Automação Litúrgica");
st.markdown("---");

// ---- SIDEBAR CONFIG ----
st.sidebar.title("⚙️ Configurações");

motor_escolhido = st.sidebar.selectbox("🎨 Motor de Imagem", ["Pollinations Flux (Padrão)", "Pollinations Turbo", "Google Imagen"], index=0);
resolucao_escolhida = st.sidebar.selectbox("📏 Resolução do Vídeo", ["9:16 (Vertical/Stories)", "16:9 (Horizontal/YouTube)", "1:1 (Quadrado/Feed)"], index=0);

st.sidebar.markdown("---");
st.sidebar.markdown("### 🅰️ Upload de Fonte (Global)");
uploaded_font_file = st.sidebar.file_uploader("Arquivo .ttf (para opção 'Upload Personalizada')", type=["ttf"]);

st.sidebar.info(f"Modo: {motor_escolhido}\\nFormato: {resolucao_escolhida}");

if "personagens_biblicos" not in st.session_state:
    st.session_state.personagens_biblicos = inicializar_personagens();

// session state
if "roteiro_gerado" not in st.session_state:
    st.session_state["roteiro_gerado"] = null; // Use null for initial state
if "generated_images_blocks" not in st.session_state:
    st.session_state["generated_images_blocks"] = {}; // Stores file paths
if "generated_audios_blocks" not in st.session_state:
    st.session_state["generated_audios_blocks"] = {}; // Stores file paths
if "generated_srt_content" not in st.session_state: // Stores raw SRT string
    st.session_state["generated_srt_content"] = "";
if "video_final_bytes" not in st.session_state:
    st.session_state["video_final_bytes"] = null;
if "meta_dados" not in st.session_state:
    st.session_state["meta_dados"] = {"data": "", "ref": ""};
if "job_loaded_from_drive" not in st.session_state:
    st.session_state["job_loaded_from_drive"] = false;
if "temp_assets_dir" not in st.session_state:
    st.session_state["temp_assets_dir"] = null;

// Carregar Settings persistentes
if "overlay_settings" not in st.session_state:
    st.session_state["overlay_settings"] = load_config();

tab1, tab2, tab3, tab4, tab5 = st.tabs(
    ["📖 Gerar Roteiro", "🎨 Personagens", "🎚️ Overlay & Efeitos", "🎥 Fábrica Vídeo (Editor)", "📊 Histórico"]
);

// --------- TAB 1: ROTEIRO ----------
with tab1:
    st.header("🚀 Gerador de Roteiro");
    col1, col2 = st.columns([2, 1]);
    with col1:
        data_selecionada = st.date_input("📅 Data da liturgia:", value=date.today(), min_value=date(2023, 1, 1));
    with col2:
        st.info("Status: ✅ pronto para gerar");

    if st.button("🚀 Gerar Roteiro Completo", type="primary", disabled=st.session_state["job_loaded_from_drive"]):
        data_str = data_selecionada.strftime("%Y-%m-%d");
        data_formatada_display = data_selecionada.strftime("%d.%m.%Y"); 

        with st.status("📝 Gerando roteiro...", expanded=True) as status:
            st.write("🔍 Buscando Evangelho...");
            liturgia = obter_evangelho_com_fallback(data_str);
            if not liturgia:
                status.update(label="Falha ao buscar evangelho", state="error");
                st.stop();

            ref_curta = formatar_referencia_curta(liturgia.get("ref_biblica"));
            st.session_state["meta_dados"] = {
                "data": data_formatada_display,
                "ref": ref_curta or "Evangelho do Dia"
            };

            st.write("🤖 Analisando personagens com IA...");
            // This Groq generation needs to be adapted to the frontend's Roteiro structure
            // For now, this is a placeholder. The primary path is loading from Drive.
            // personagens_detectados = analisar_personagens_groq(liturgia["texto"], st.session_state.personagens_biblicos)
            roteiro_generated_raw = gerar_roteiro_com_prompts_groq(liturgia["texto"], liturgia["referencia_liturgica"], st.session_state.personagens_biblicos);

            if roteiro_generated_raw:
                // Assuming the Groq output is adapted to match frontend's Roteiro structure, e.g.:
                // {"hook": {"text": "...", "prompt": "..."}, "leitura": {"text": "...", "prompt": "..."}, ...}
                st.session_state["roteiro_gerado"] = roteiro_generated_raw; 
                status.update(label="Roteiro gerado com sucesso!", state="complete", expanded=False);
            else:
                status.update(label="Erro ao gerar roteiro", state="error");
                st.stop();

        // The 'leitura_montada' is now part of the 'roteiro_gerado.leitura.text'
        // st.session_state["leitura_montada"] = montar_leitura_com_formula(liturgia["texto"], liturgia.get("ref_biblica"))
        st.rerun();

    if st.session_state.get("roteiro_gerado"):
        roteiro_data = st.session_state["roteiro_gerado"];
        st.markdown("---");
        // Ensure correct keys are used as per frontend's Roteiro interface (hook.text, leitura.text etc.)
        st.markdown("### 🎣 HOOK"); st.markdown(roteiro_data.get("hook", {}).get("text", "")); st.code(roteiro_data.get("hook", {}).get("prompt", ""), language="text");
        st.markdown("### 📖 LEITURA"); st.markdown(roteiro_data.get("leitura", {}).get("text", "")[:300] + "..."); st.code(roteiro_data.get("leitura", {}).get("prompt", ""), language="text");
        st.markdown("### 💭 REFLEXÃO"); st.markdown(roteiro_data.get("reflexao", {}).get("text", "")); st.code(roteiro_data.get("reflexao", {}).get("prompt", ""), language="text");
        st.markdown("### 🌟 APLICAÇÃO"); st.markdown(roteiro_data.get("aplicacao", {}).get("text", "")); st.code(roteiro_data.get("aplicacao", {}).get("prompt", ""), language="text");
        st.markdown("### 🙏 ORAÇÃO"); st.markdown(roteiro_data.get("oracao", {}).get("text", "")); st.code(roteiro_data.get("oracao", {}).get("prompt", ""), language="text");
        // The frontend payload does not explicitly include 'prompt_geral' anymore in Roteiro
        // st.markdown("### 🖼️ THUMBNAIL"); st.code(roteiro_data.get("prompt_geral", ""), language="text") 
        st.success("Roteiro gerado! Vá para 'Overlay & Efeitos' para ajustar o visual.");

// --------- TAB 2: PERSONAGENS ----------
with tab2:
    st.header("🎨 Banco de Personagens");
    banco = st.session_state.personagens_biblicos.copy();
    col1, col2 = st.columns(2);
    with col1:
        for i, (nome, desc) in enumerate(banco.items()):
            with st.expander(f"✏️ {nome}"):
                novo_nome = st.text_input(f"Nome", value=nome, key=f"n_{i}");
                nova_desc = st.text_area(f"Desc", value=desc, key=f"d_{i}");
                if st.button("Salvar", key=f"s_{i}"):
                    if novo_nome != nome: del st.session_state.personagens_biblicos[nome];
                    st.session_state.personagens_biblicos[novo_nome] = nova_desc;
                    st.rerun();
                if st.button("Apagar", key=f"a_{i}"):
                    del st.session_state.personagens_biblicos[nome];
                    st.rerun();
    with col2:
        st.markdown("### ➕ Novo");
        nn = st.text_input("Nome", key="new_n");
        nd = st.text_area("Descrição", key="new_d");
        if st.button("Adicionar") and nn and nd:
            st.session_state.personagens_biblicos[nn] = nd;
            st.rerun();

// --------- TAB 3: OVERLAY & EFEITOS ----------
with tab3:
    st.header("🎚️ Editor de Overlay & Efeitos");
    
    col_settings, col_preview = st.columns([1, 1]);
    ov_sets = st.session_state["overlay_settings"];
    font_options = ["Padrão (Sans)", "Serif", "Monospace", "Upload Personalizada"];
    anim_options = ["Estático", "Fade In", "Fade In/Out"];
    
    with col_settings:
        with st.expander("✨ Efeitos Visuais (Movimento)", expanded=True):
            effect_opts = ["Zoom In (Ken Burns)", "Zoom Out", "Panorâmica Esquerda", "Panorâmica Direita", "Estático (Sem movimento)"];
            curr_eff = ov_sets.get("effect_type", effect_opts[0]);
            if curr_eff not in effect_opts: curr_eff = effect_opts[0];
            ov_sets["effect_type"] = st.selectbox("Tipo de Movimento", effect_opts, index=effect_opts.index(curr_eff));
            ov_sets["effect_speed"] = st.slider("Intensidade do Movimento", 1, 10, ov_sets.get("effect_speed", 3), help="1 = Muito Lento, 10 = Rápido");

        with st.expander("🎬 Transições de Cena", expanded=True):
            trans_opts = ["Fade (Escurecer)", "Corte Seco (Nenhuma)"];
            curr_trans = ov_sets.get("trans_type", trans_opts[0]);
            if curr_trans not in trans_opts: curr_trans = trans_opts[0];
            ov_sets["trans_type"] = st.selectbox("Tipo de Transição", trans_opts, index=trans_opts.index(curr_trans));
            ov_sets["trans_dur"] = st.slider("Duração da Transição (s)", 0.1, 2.0, ov_sets.get("trans_dur", 0.5), 0.1);

        with st.expander("📝 Texto Overlay (Cabeçalho)", expanded=True):
            st.markdown("**Linha 1: Título**");
            curr_f1 = ov_sets.get("line1_font", font_options[0]);
            if curr_f1 not in font_options: curr_f1 = font_options[0];
            ov_sets["line1_font"] = st.selectbox("Fonte L1", font_options, index=font_options.index(curr_f1), key="f1");
            ov_sets["line1_size"] = st.slider("Tamanho L1", 10, 150, ov_sets.get("line1_size", 40), key="s1");
            ov_sets["line1_y"] = st.slider("Posição Y L1", 0, 800, ov_sets.get("line1_y", 40), key="y1");
            
            curr_a1 = ov_sets.get("line1_anim", anim_options[0]);
            if curr_a1 not in anim_options: curr_a1 = anim_options[0];
            ov_sets["line1_anim"] = st.selectbox("Animação L1", anim_options, index=anim_options.index(curr_a1), key="a1");
            
            st.markdown("---");
            st.markdown("**Linha 2: Data**");
            curr_f2 = ov_sets.get("line2_font", font_options[0]);
            if curr_f2 not in font_options: curr_f2 = font_options[0];
            ov_sets["line2_font"] = st.selectbox("Fonte L2", font_options, index=font_options.index(curr_f2), key="f2");
            ov_sets["line2_size"] = st.slider("Tamanho L2", 10, 150, ov_sets.get("line2_size", 28), key="s2");
            ov_sets["line2_y"] = st.slider("Posição Y L2", 0, 800, ov_sets.get("line2_y", 90), key="y2");
            
            curr_a2 = ov_sets.get("line2_anim", anim_options[0]);
            if curr_a2 not in anim_options: curr_a2 = anim_options[0];
            ov_sets["line2_anim"] = st.selectbox("Animação L2", anim_options, index=anim_options.index(curr_a2), key="a2");

            st.markdown("---");
            st.markdown("**Linha 3: Referência**");
            curr_f3 = ov_sets.get("line3_font", font_options[0]);
            if curr_f3 not in font_options: curr_f3 = font_options[0];
            ov_sets["line3_font"] = st.selectbox("Fonte L3", font_options, index=font_options.index(curr_f3), key="f3");
            ov_sets["line3_size"] = st.slider("Tamanho L3", 10, 150, ov_sets.get("line3_size", 24), key="s3");
            ov_sets["line3_y"] = st.slider("Posição Y L3", 0, 800, ov_sets.get("line3_y", 130), key="y3");
            
            curr_a3 = ov_sets.get("line3_anim", anim_options[0]);
            if curr_a3 not in anim_options: curr_a3 = anim_options[0];
            ov_sets["line3_anim"] = st.selectbox("Animação L3", anim_options, index=anim_options.index(curr_a3), key="a3");

        st.session_state["overlay_settings"] = ov_sets;
        if st.button("💾 Salvar Configurações (Persistente)"):
            if save_config(ov_sets):
                st.success("Configuração salva no disco com sucesso!");

    with col_preview:
        st.subheader("Pré-visualização (Overlay)");
        res_params = get_resolution_params(resolucao_escolhida);
        preview_scale_factor = 0.4;
        preview_w = int(res_params["w"] * preview_scale_factor);
        preview_h = int(res_params["h"] * preview_scale_factor);
        text_scale = preview_scale_factor;

        meta = st.session_state.get("meta_dados", {});
        const txt_l1 = "EVANGELHO";
        const txt_l2 = meta.get("data", "29.11.2025");
        const txt_l3 = meta.get("ref", "Lucas, Cap. 1, 26-38");
        
        const preview_texts = [
            {"text": txt_l1, "size": int(ov_sets["line1_size"] * text_scale), "y": int(ov_sets["line1_y"] * text_scale), "font_style": ov_sets["line1_font"], "color": "white"},
            {"text": txt_l2, "size": int(ov_sets["line2_size"] * text_scale), "y": int(ov_sets["line2_y"] * text_scale), "font_style": ov_sets["line2_font"], "color": "white"},
            {"text": txt_l3, "size": int(ov_sets["line3_size"] * text_scale), "y": int(ov_sets["line3_y"] * text_scale), "font_style": ov_sets["line3_font"], "color": "white"},
        ];
        
        const prev_img = criar_preview_overlay(preview_w, preview_h, preview_texts, uploaded_font_file);
        st.image(prev_img, caption=f"Preview Overlay em {resolucao_escolhida}", use_column_width=False);


// --------- TAB 4: FÁBRICA DE VÍDEO ----------
with tab4:
    st.header("🎥 Editor de Cenas");
    
    // --- Carregamento de Job via Drive ---
    st.subheader("⬇️ Carregar Job do Google Drive");
    job_id_input = st.text_input("Cole o Job ID do Frontend aqui:", key="drive_job_id_input");
    if st.button("📥 Carregar Job", type="secondary", disabled=not job_id_input):
        if job_id_input:
            with st.status(f"Buscando job '{job_id_input}' no Google Drive...", expanded=True) as status_box:
                // Clean up previous temp dir if exists
                if st.session_state.get("temp_assets_dir") and os.path.exists(st.session_state["temp_assets_dir"]):
                    _shutil.rmtree(st.session_state["temp_assets_dir"]);
                    st.write(f"Diretório temporário anterior removido: {st.session_state['temp_assets_dir']}");

                temp_assets_dir = tempfile.mkdtemp(); // Create a new temp directory for assets
                st.write(f"Criado diretório temporário para assets: {temp_assets_dir}");
                
                payload = load_job_from_drive(job_id_input);
                if payload:
                    st.write("Payload carregado, processando assets...");
                    if process_job_payload_and_update_state(payload, temp_assets_dir):
                        st.session_state["job_loaded_from_drive"] = True;
                        st.session_state["temp_assets_dir"] = temp_assets_dir; // Store temp dir for cleanup
                        status_box.update(label=f"Job '{job_id_input}' carregado e pronto para renderizar!", state="complete");
                        st.rerun(); // Rerun to reflect updated state
                    else:
                        status_box.update(label="Erro ao processar os assets do job.", state="error");
                        _shutil.rmtree(temp_assets_dir); // Clean up on error
                        st.session_state["temp_assets_dir"] = None;
                else:
                    status_box.update(label="Falha ao carregar o job do Drive.", state="error");
                    _shutil.rmtree(temp_assets_dir); // Clean up on error
                    st.session_state["temp_assets_dir"] = None;
        else:
            st.warning("Por favor, insira um Job ID.");
    st.markdown("---");

    is_job_loaded = st.session_state.get("job_loaded_from_drive", false);
    
    if !st.session_state.get("roteiro_gerado")) {
        st.warning("⚠️ Gere o roteiro na Aba 1 OU carregue um Job do Drive.");
        st.stop();
    }
    
    const roteiro = st.session_state["roteiro_gerado"];
    
    const blocos_config = [
        {"id": "hook", "label": "🎣 HOOK", "text_path": "hook", "prompt_path": "hook"},
        {"id": "leitura", "label": "📖 LEITURA", "text_path": "leitura", "prompt_path": "leitura"}, 
        {"id": "reflexao", "label": "💭 REFLEXÃO", "text_path": "reflexao", "prompt_path": "reflexao"},
        {"id": "aplicacao", "label": "🌟 APLICAÇÃO", "text_path": "aplicacao", "prompt_path": "aplicacao"},
        {"id": "oracao", "label": "🙏 ORAÇÃO", "text_path": "oracao", "prompt_path": "oracao"},
        // "thumbnail" is not part of video sequence, handled separately if needed
    ];

    st.info(f"⚙️ Config: **{motor_escolhido}** | Resolução: **{resolucao_escolhida}**");

    // Botões de Geração em Lote (Topo da Fábrica)
    // These buttons should be disabled if a job is loaded from Drive
    col_batch_1, col_batch_2 = st.columns(2);
    
    // Extract aspect ratio for image generation
    const aspectRatioForImageGen = (() => {
        if (resolucao_escolhida.includes("9:16")) return "9:16";
        if (resolucao_escolhida.includes("16:9")) return "16:9";
        return "1:1";
    })();

    with col_batch_1:
        if st.button("🔊 Gerar Todos os Áudios", use_container_width=true, disabled=is_job_loaded):
            with st.status("Gerando áudios em lote...", expanded=true) as status:
                const total = len(blocos_config);
                let count = 0;
                for (const b of blocos_config) {
                    const bid = b["id"];
                    const txt = roteiro.get(b["text_path"], {}).get("text", "");
                    if (txt) {
                        st.write(f"Gerando áudio: {b['label']}...");
                        try {
                            const audio_bio = gerar_audio_gtts(txt);
                            if (audio_bio) {
                                const audio_path = os.path.join(tempfile.gettempdir(), f"{bid}.mp3");
                                with open(audio_path, "wb") as f:
                                    f.write(audio_bio.getvalue());
                                st.session_state["generated_audios_blocks"][bid] = audio_path;
                                count += 1;
                            }
                        } catch (e) {
                            st.error(f"Erro em {bid}: {e}");
                        }
                    }
                }
                status.update(label=f"Concluído! {count}/{total} áudios gerados.", state="complete");
                st.rerun();
    with col_batch_2:
        if st.button("✨ Gerar Todas as Imagens", use_container_width=true, disabled=is_job_loaded):
            with st.status("Gerando imagens em lote...", expanded=true) as status:
                const total = len(blocos_config);
                let count = 0;
                for (const i, b of enumerate(blocos_config)) {
                    const bid = b["id"];
                    const prompt = roteiro.get(b["prompt_path"], {}).get("prompt", "");
                    if (prompt) {
                        st.write(f"Gerando imagem ({i+1}/{total}): {b['label']}...");
                        try {
                            const img_bio = despachar_geracao_imagem(prompt, motor_escolhido, resolucao_escolhida);
                            if (img_bio) {
                                const img_path = os.path.join(tempfile.gettempdir(), f"{bid}.png");
                                with open(img_path, "wb") as f:
                                    f.write(img_bio.getvalue());
                                st.session_state["generated_images_blocks"][bid] = img_path;
                                count += 1;
                            }
                        } catch (e) {
                            st.error(f"Erro em {bid}: {e}");
                        }
                    }
                }
                status.update(label=f"Concluído! {count}/{total} imagens geradas.", state="complete");
                st.rerun();

    st.divider();

    for (const bloco of blocos_config) {
        const block_id = bloco["id"];
        with st.container(border=true) {
            st.subheader(bloco["label"]);
            const col_text, col_media = st.columns([1, 1.2]);
            with col_text {
                // Text is now from roteiro.get(b["text_path"], {}).get("text", "")
                const txt_content = roteiro.get(bloco["text_path"], {}).get("text", "");
                st.caption("📜 Texto para Narração:");
                st.markdown(f"_{txt_content.substring(0, 250)}..._" if txt_content else "_Sem texto_");
                
                // Audio generation button disabled if loaded from drive
                if (st.button(f"🔊 Gerar Áudio ({block_id})", key=f"btn_audio_{block_id}", disabled=is_job_loaded)) {
                    if (txt_content) {
                        try {
                            const audio_bio = gerar_audio_gtts(txt_content);
                            if (audio_bio) {
                                const audio_path = os.path.join(tempfile.gettempdir(), f"{bid}.mp3");
                                with open(audio_path, "wb") as f:
                                    f.write(audio_bio.getvalue());
                                st.session_state["generated_audios_blocks"][bid] = audio_path;
                                st.rerun();
                            }
                        } catch (e) {
                            st.error(f"Erro áudio: {e}");
                        }
                    }
                }
                
                // Display audio if available (either generated or loaded from Drive)
                const audio_path_display = st.session_state["generated_audios_blocks"].get(block_id);
                if (audio_path_display && os.path.exists(audio_path_display)) {
                    st.audio(audio_path_display, format="audio/mp3");
                }
                
                // Prompt is now from roteiro.get(b["prompt_path"], {}).get("prompt", "")
                const prompt_content = roteiro.get(bloco["prompt_path"], {}).get("prompt", "");
                st.caption("📋 Prompt Visual:");
                st.code(prompt_content, language="text");
            }
            
            with col_media {
                st.caption("🖼️ Imagem da Cena:");
                const img_path_display = st.session_state["generated_images_blocks"].get(block_id);
                if (img_path_display && os.path.exists(img_path_display)) {
                    try {
                        st.image(img_path_display, use_column_width=true);
                    } catch (Exception) {
                        st.error("Erro ao exibir imagem.");
                    }
                } else {
                    st.info("Nenhuma imagem definida.");
                }
                
                const c_gen, c_up = st.columns([1.5, 2]);
                with c_gen {
                    // Image generation button disabled if loaded from drive
                    if (st.button(f"✨ Gerar ({resolucao_escolhida.split()[0]})", key=f"btn_gen_{block_id}", disabled=is_job_loaded)) {
                        if (prompt_content) {
                            with st.spinner(f"Criando no formato {resolucao_escolhida}...") {
                                try {
                                    const img_bio = despachar_geracao_imagem(prompt_content, motor_escolhido, resolucao_escolhida);
                                    if (img_bio) {
                                        const img_path = os.path.join(tempfile.gettempdir(), f"{bid}.png");
                                        with open(img_path, "wb") as f:
                                            f.write(img_bio.getvalue());
                                        st.session_state["generated_images_blocks"][bid] = img_path;
                                        st.success("Gerada!");
                                        st.rerun();
                                    }
                                } catch (e) {
                                    st.error(f"Erro: {e}");
                                }
                            }
                        } else {
                            st.warning("Sem prompt.");
                        }
                    }
                }
                with c_up {
                    const uploaded_file = st.file_uploader("Ou envie a sua:", type=["png", "jpg", "jpeg"], key=f"upload_{block_id}", disabled=is_job_loaded);
                    if (uploaded_file is not None) {
                        const bytes_data = uploaded_file.read();
                        const img_path = os.path.join(tempfile.gettempdir(), f"{block_id}_uploaded.png");
                        with open(img_path, "wb") as f:
                            f.write(bytes_data);
                        st.session_state["generated_images_blocks"][block_id] = img_path;
                        st.success("Enviada!");
                    }
                }
            }
        }
    }
    st.divider();
    st.header("🎬 Finalização");
    const usar_overlay = st.checkbox("Adicionar Cabeçalho (Overlay Personalizado)", value=true);
    
    st.subheader("🎵 Música de Fundo (Opcional)");
    
    // Check if saved music exists
    const saved_music_exists = os.path.exists(SAVED_MUSIC_FILE);
    
    const col_mus_1, col_mus_2 = st.columns(2);
    
    with col_mus_1 {
        if (saved_music_exists) {
            st.success("💾 Música Padrão Ativa");
            st.audio(SAVED_MUSIC_FILE);
            if (st.button("❌ Remover Música Padrão")) {
                if (delete_music_file()) {
                    st.rerun();
                }
            }
        } else {
            st.info("Nenhuma música padrão salva.");
        }
    }
    with col_mus_2 {
        const music_upload = st.file_uploader("Upload Música (MP3)", type=["mp3"]);
        if (music_upload) {
            st.audio(music_upload);
            if (st.button("💾 Salvar como Música Padrão")) {
                if (save_music_file(music_upload.getvalue())) {
                    st.success("Música padrão salva!");
                    st.rerun();
                }
            }
        }
    }
    const music_vol = st.slider("Volume da Música (em relação à voz)", 0.0, 1.0, load_config().get("music_vol", 0.15));

    // Display SRT content if loaded from Drive or generated manually
    if (st.session_state.get("generated_srt_content")) {
        st.subheader("📄 Legendas (SRT)");
        st.code(st.session_state["generated_srt_content"], language="srt");
        if (st.download_button("⬇️ Baixar SRT", st.session_state["generated_srt_content"], "legendas.srt", "text/plain")) {
            // pass
        }
    }
    if (st.button("Renderizar Vídeo Completo (Unir tudo)", type="primary")) {
        with st.status("Renderizando vídeo com efeitos...", expanded=true) as status {
            let temp_dir_render = null;
            try {
                if (!shutil_which("ffmpeg")) {
                    status.update(label="FFmpeg não encontrado!", state="error");
                    st.stop();
                }
                
                temp_dir_render = tempfile.mkdtemp(); // Separate temp dir for rendering output
                const clip_files = [];
                
                const font_path = resolve_font_path(st.session_state["overlay_settings"]["line1_font"], uploaded_font_file); // Use a font for consistency
                if (usar_overlay && !font_path) {
                    st.warning("⚠️ Fonte não encontrada. O overlay pode falhar.");
                }
                
                const meta = st.session_state.get("meta_dados", {});
                const txt_dt = meta.get("data", "");
                const txt_ref = meta.get("ref", "");
                
                const map_titulos = {"hook": "EVANGELHO", "leitura": "EVANGELHO", "reflexao": "REFLEXÃO", "aplicacao": "APLICAÇÃO", "oracao": "ORAÇÃO"};
                
                const res_params = get_resolution_params(resolucao_escolhida);
                const s_out = f"{res_params['w']}x{res_params['h']}";
                
                const sets = st.session_state["overlay_settings"];
                const speed_val = sets["effect_speed"] * 0.0005; 
                
                let zoom_expr;
                if (sets["effect_type"] == "Zoom In (Ken Burns)") {
                    zoom_expr = f"z='min(zoom+{speed_val},1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'";
                } else if (sets["effect_type"] == "Zoom Out") {
                    zoom_expr = f"z='max(1,1.5-{speed_val}*on)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'";
                } else if (sets["effect_type"] == "Panorâmica Esquerda") {
                    zoom_expr = f"z=1.2:x='min(x+{speed_val}*100,iw-iw/zoom)':y='(ih-ih/zoom)/2'";
                } else if (sets["effect_type"] == "Panorâmica Direita") {
                    zoom_expr = f"z=1.2:x='max(0,x-{speed_val}*100)':y='(ih-ih/zoom)/2'";
                } else { 
                    zoom_expr = "z=1:x=0:y=0"; 
                }

                for (const b of blocos_config) {
                    const bid = b["id"];
                    const img_path = st.session_state["generated_images_blocks"].get(bid); 
                    const audio_path = st.session_state["generated_audios_blocks"].get(bid); 
                    
                    if (!img_path || !audio_path || !os.path.exists(img_path) || !os.path.exists(audio_path)) { 
                        st.warning(f"⚠️ Ignorando bloco '{bid}' na renderização devido a imagem ou áudio ausente/inválido.");
                        continue;
                    }
                        
                    st.write(f"Processando clipe: {bid}...");
                    const clip_path = os.path.join(temp_dir_render, f"{bid}_clip.mp4"); 
                    
                    const dur = get_audio_duration_seconds(audio_path) || 5.0;
                    const frames = int(dur * 25);

                    const vf_filters = [];
                    if (sets["effect_type"] != "Estático (Sem movimento)") {
                        vf_filters.append(f"zoompan={zoom_expr}:d={frames}:s={s_out}");
                    } else {
                        vf_filters.append(f"scale={s_out}");
                    }

                    if (sets["trans_type"] == "Fade (Escurecer)") {
                        const td = sets["trans_dur"];
                        vf_filters.append(f"fade=t=in:st=0:d={td},fade=t=out:st={dur-td}:d={td}");
                    }

                    if (usar_overlay) {
                        const titulo_atual = map_titulos.get(bid, "EVANGELHO");
                        const f1_path = resolve_font_path(sets["line1_font"], uploaded_font_file);
                        const f2_path = resolve_font_path(sets["line2_font"], uploaded_font_file);
                        const f3_path = resolve_font_path(sets["line3_font"], uploaded_font_file);
                        
                        const alp1 = get_text_alpha_expr(sets.get("line1_anim", "Estático"), dur);
                        const alp2 = get_text_alpha_expr(sets.get("line2_anim", "Estático"), dur);
                        const alp3 = get_text_alpha_expr(sets.get("line3_anim", "Estático"), dur);

                        const clean_t1 = sanitize_text_for_ffmpeg(titulo_atual);
                        const clean_t2 = sanitize_text_for_ffmpeg(txt_dt);
                        const clean_t3 = sanitize_text_for_ffmpeg(txt_ref);

                        if (f1_path) vf_filters.append(f"drawtext=fontfile='{f1_path}':text='{clean_t1}':fontcolor=white:fontsize={sets['line1_size']}:x=(w-text_w)/2:y={sets['line1_y']}:shadowcolor=black:shadowx=2:shadowy=2:{alp1}");
                        if (f2_path) vf_filters.append(f"drawtext=fontfile='{f2_path}':text='{clean_t2}':fontcolor=white:fontsize={sets['line2_size']}:x=(w-text_w)/2:y={sets['line2_y']}:shadowcolor=black:shadowx=2:shadowy=2:{alp2}");
                        if (f3_path) vf_filters.append(f"drawtext=fontfile='{f3_path}':text='{clean_t3}':fontcolor=white:fontsize={sets['line3_size']}:x=(w-text_w)/2:y={sets['line3_y']}:shadowcolor=black:shadowx=2:shadowy=2:{alp3}");
                    }

                    const filter_complex = ",".join(vf_filters);
                    
                    const cmd = ["ffmpeg", "-y", "-loop", "1", "-i", img_path, "-i", audio_path, "-vf", filter_complex, "-c:v", "libx264", "-t", f"{dur}", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip_path];
                    run_cmd(cmd);
                    clip_files.append(clip_path);
                }
                
                if (clip_files) {
                    const concat_list = os.path.join(temp_dir_render, "list.txt");
                    with open(concat_list, "w") as f:
                        for (const p of clip_files) f.write(f"file '{p}'\\n");
                    
                    const temp_video = os.path.join(temp_dir_render, "temp_video.mp4");
                    run_cmd(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_list, "-c", "copy", temp_video]);
                    
                    const final_path = os.path.join(temp_dir_render, "final.mp4");
                    
                    // Lógica de Música: 1. Uploaded, 2. Saved Default, 3. None
                    let music_source_path = null;
                    
                    if (music_upload) {
                        music_source_path = os.path.join(temp_dir_render, "bg.mp3");
                        with open(music_source_path, "wb") as f: f.write(music_upload.getvalue());
                    } else if (saved_music_exists) {
                        music_source_path = SAVED_MUSIC_FILE;
                    }
                        
                    if (music_source_path) {
                        const cmd_mix = [
                            "ffmpeg", "-y",
                            "-i", temp_video,
                            "-stream_loop", "-1", "-i", music_source_path,
                            "-filter_complex", f"[1:a]volume={music_vol}[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2[a]",
                            "-map", "0:v", "-map", "[a]",
                            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", // ensure re-encode for consistent output
                            final_path
                        ];
                        run_cmd(cmd_mix);
                    } else {
                        os.rename(temp_video, final_path);
                    }

                    with open(final_path, "rb") as f:
                        st.session_state["video_final_bytes"] = BytesIO(f.read());
                    status.update(label="Vídeo Renderizado com Sucesso!", state="complete");
                } else {
                    status.update(label="Nenhum clipe válido gerado.", state="error");
                }
            } catch (Exception as e) {
                status.update(label="Erro na renderização", state="error");
                st.error(f"Detalhes: {e}");
                st.error(traceback.format_exc());
            } finally {
                // Clean up all temporary directories
                if (st.session_state.get("temp_assets_dir") && os.path.exists(st.session_state["temp_assets_dir"])) {
                    _shutil.rmtree(st.session_state["temp_assets_dir"]);
                    del st.session_state["temp_assets_dir"]; // Clear the state
                    st.info("📦 Arquivos temporários de assets do job removidos.");
                }
                if (temp_dir_render && os.path.exists(temp_dir_render)) {
                    _shutil.rmtree(temp_dir_render);
                    st.info("📦 Arquivos temporários de renderização removidos.");
                }
            }
        }

    if (st.session_state.get("video_final_bytes")) {
        st.success("Vídeo pronto!");
        st.video(st.session_state["video_final_bytes"]);
        st.download_button("⬇️ Baixar MP4", st.session_state["video_final_bytes"], "video_jhonata.mp4", "video/mp4");
    }

// --------- TAB 5: HISTÓRICO ----------
with tab5 {
    st.info("Histórico em desenvolvimento.");
}

st.markdown("---");
st.caption("Studio Jhonata v20.0 - Música Padrão");
`;

const App: React.FC = () => {
  // --- State ---
  const [dateStr, setDateStr] = useState<string>(new Date().toISOString().split('T')[0]);
  const [category, setCategory] = useState<string>('evangelho');
  const [liturgy, setLiturgy] = useState<LiturgyData | null>(null);
  const [reference, setReference] = useState<string>('');
  
  const [introStyle, setIntroStyle] = useState<IntroStyle>(IntroStyle.Viral);
  const [visualStyle, setVisualStyle] = useState<VisualStyle>(VisualStyle.Cinematic);
  const [voice, setVoice] = useState<VoiceOption>(VoiceOption.Alnilam);
  // Fix: Add state for video resolution, matching the options in the Python code
  const [videoResolution, setVideoResolution] = useState<string>('9:16 (Vertical/Stories)');

  const [roteiro, setRoteiro] = useState<Roteiro | null>(null);
  const [processingState, setProcessingState] = useState<ProcessingState>(ProcessingState.Idle);
  const [progressMsg, setProgressMsg] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [quotaExceededMessage, setQuotaExceededMessage] = useState<boolean>(false);
  
  const [jobId, setJobId] = useState<string>('');
  const [fetchSource, setFetchSource] = useState<'API' | 'Search/AI' | ''>('');

  const [showDeveloperTools, setShowDeveloperTools] = useState<boolean>(false);
  const [showGasCode, setShowGasCode] = useState<boolean>(false);
  const [showPythonCode, setShowPythonCode] = useState<boolean>(false);
  const [showLogs, setShowLogs] = useState<boolean>(false);
  // Fix: Correctly initialize useState with LogEntry[] type and import useState.
  const [logs, setLogs] = useState<LogEntry[]>(logger.getLogs());

  // --- Effects ---
  useEffect(() => {
    logger.info('App initialized');
    // Refresh logs every second if the log viewer is open
    const interval = setInterval(() => {
      if (showLogs || showDeveloperTools) { // Also update if developer tools are open
        setLogs(logger.getLogs());
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [showLogs, showDeveloperTools]); // Depend on showDeveloperTools

  useEffect(() => {
    if (dateStr) {
      handleFetchLiturgy();
    }
  }, [dateStr]);

  useEffect(() => {
    if (liturgy) {
      let ref = "";
      if (category === 'evangelho') ref = liturgy.evangelho;
      else if (category === 'primeira_leitura') ref = liturgy.primeira_leitura;
      else if (category === 'segunda_leitura') ref = liturgy.segunda_leitura;
      else if (category === 'salmo') ref = liturgy.salmo;
      
      setReference(ref || "Ref unavailable");
    }
  }, [category, liturgy]);

  // --- Handlers ---

  const handleFetchLiturgy = async () => {
    setProcessingState(ProcessingState.FetchingLiturgy);
    setErrorMessage('');
    setLiturgy(null);
    setFetchSource('');
    setRoteiro(null); // Clear previous roteiro when fetching new liturgy
    logger.info(`Starting liturgy fetch for date: ${dateStr}`);

    try {
      // 1. Try Direct API (Vercel)
      logger.info("Attempting Direct API fetch...");
      const data = await liturgyService.fetchLiturgyFromApi(dateStr);
      setLiturgy(data);
      setFetchSource('API');
      setProcessingState(ProcessingState.Idle);
      logger.info("Liturgy fetched successfully from API.");
    } catch (apiError: any) {
      logger.warn("API Fetch failed, switching to AI Search Fallback.", apiError);
      
      try {
        // 2. Fallback: Gemini Search Grounding
        const fallbackData = await geminiService.fetchLiturgyFallback(dateStr, category);
        setLiturgy(fallbackData);
        setFetchSource('Search/AI');
        setProcessingState(ProcessingState.Idle);
        logger.info("Liturgy fetched successfully from Gemini Search Fallback.");
      } catch (aiError: any) {
        const msg = "Failed to fetch liturgy from both API and Search: " + aiError.message;
        setErrorMessage(msg);
        setProcessingState(ProcessingState.Error);
        logger.error(msg, aiError);
      }
    }
  };

  const handleGenerateScript = async () => {
    if (!liturgy) {
      setErrorMessage("Please fetch liturgy first.");
      logger.warn("Script generation attempted without fetched liturgy.");
      return;
    }
    
    // Determine the text content based on category
    let textToUse = "";
    if (category === 'evangelho') textToUse = liturgy.texto_evangelho;
    else if (category === 'primeira_leitura') textToUse = liturgy['texto_primeira_leitura'] || liturgy.primeira_leitura;
    else if (category === 'segunda_leitura') textToUse = liturgy['texto_segunda_leitura'] || liturgy.segunda_leitura;
    else if (category === 'salmo') textToUse = liturgy['texto_salmo'] || liturgy.salmo;
    
    if (!textToUse && liturgy.texto_evangelho) textToUse = liturgy.texto_evangelho;

    if (!textToUse) {
        const msg = "No text available for the selected category to generate script.";
        setErrorMessage(msg);
        logger.error(msg, { category, liturgy });
        return;
    }

    setProcessingState(ProcessingState.GeneratingScript);
    setProgressMsg("Consulting Gemini for script & prompts...");
    setErrorMessage('');
    logger.info("Starting script generation with Gemini...");
    
    try {
      // 1. Generate standard blocks and prompts via AI
      const generatedParts = await geminiService.generateScript(
        reference,
        textToUse,
        visualStyle,
        introStyle
      );

      // 2. Construct the Liturgical Reading Block (Formula based)
      // This is done locally, not by AI, to ensure accuracy to the rite
      const formattedReadingText = liturgyService.formatLiturgicalReading(textToUse, reference);

      // 3. Assemble full Roteiro, defensively checking for undefined parts
      const fullRoteiro: Roteiro = {
        hook: generatedParts.hook || { text: '', prompt: '' },
        leitura: {
          text: formattedReadingText,
          prompt: generatedParts.prompt_leitura || '' // AI provided prompt for this
        },
        reflexao: generatedParts.reflexao || { text: '', prompt: '' },
        aplicacao: generatedParts.aplicacao || { text: '', prompt: '' },
        oracao: generatedParts.oracao || { text: '', prompt: '' }
      };

      setRoteiro(fullRoteiro);
      setProcessingState(ProcessingState.Idle);
      logger.info("Script generation completed successfully.", fullRoteiro);
    } catch (e: any) {
      const msg = "Script generation failed: " + e.message;
      setErrorMessage(msg);
      setProcessingState(ProcessingState.Error);
      logger.error(msg, e);
    }
  };

  const handleFullAutomation = async () => {
    if (!roteiro) {
      setErrorMessage("Please generate a script first.");
      logger.warn("Full automation attempted without a generated script.");
      return;
    }

    setProcessingState(ProcessingState.GeneratingMedia);
    setErrorMessage('');
    setSuccessMessage('');
    setQuotaExceededMessage(false);
    logger.info("Starting full automation flow: generating media and uploading...");
    
    try {
      const assets: GeneratedAsset[] = [];
      
      // Fix: Use the new `videoResolution` state variable
      // Determine the aspect ratio for image generation based on selected video resolution
      const aspectRatioForImageGen = (() => {
          if (videoResolution.includes("9:16")) return "9:16";
          if (videoResolution.includes("16:9")) return "16:9";
          return "1:1";
      })();

      const blocks = [
        { id: 'hook', data: roteiro.hook },
        { id: 'leitura', data: roteiro.leitura },
        { id: 'reflexao', data: roteiro.reflexao },
        { id: 'aplicacao', data: roteiro.aplicacao },
        { id: 'oracao', data: roteiro.oracao },
      ];

      // 1. Generate Images & Audio in Parallel (with limited concurrency to be safe)
      let completedAssetCount = 0;
      
      for (const block of blocks) {
        // Ensure block.data exists before accessing its properties
        if (!block.data) {
          logger.warn(`Skipping block ${block.id} due to missing script data.`);
          setErrorMessage(prev => prev + `Missing script data for ${block.id}. `);
          continue;
        }

        setProgressMsg(`Generating Assets for: ${block.id.toUpperCase()}...`);
        logger.info(`Generating assets for block: ${block.id}`);
        
        // Image
        try {
          // Pass aspectRatioForImageGen to geminiService.generateImage
          const imgB64 = await geminiService.generateImage(block.data.prompt, visualStyle, aspectRatioForImageGen);
          assets.push({ block_id: block.id, type: 'image', data_b64: imgB64 });
          completedAssetCount++;
        } catch (e: any) {
            logger.error(`Failed to generate image for block: ${block.id}`, e, { prompt: block.data.prompt.substring(0, 50), style: visualStyle, aspectRatio: aspectRatioForImageGen });
            // Check for API quota error (429)
            if (e.message && e.message.includes('429') && e.message.includes('RESOURCE_EXHAUSTED')) {
              setQuotaExceededMessage(true);
              setProcessingState(ProcessingState.Error);
              return; // Stop further processing
            }
            setErrorMessage(prev => prev + `Failed image for ${block.id}. `);
        }

        // Audio
        try {
          const audioB64 = await geminiService.generateSpeech(block.data.text, voice);
          assets.push({ block_id: block.id, type: 'audio', data_b64: audioB64 });
          completedAssetCount++;
        } catch (e: any) {
            logger.error(`Failed to generate audio for block: ${block.id}`, e, { text: block.data.text.substring(0, 100) });
            // Check for API quota error (429) - though less likely for TTS
            if (e.message && e.message.includes('429') && e.message.includes('RESOURCE_EXHAUSTED')) {
              setQuotaExceededMessage(true);
              setProcessingState(ProcessingState.Error);
              return; // Stop further processing
            }
            setErrorMessage(prev => prev + `Failed audio for ${block.id}. `);
        }
      }
      logger.info(`Generated ${completedAssetCount} individual assets (images/audio).`);

      // If any specific block generation failed, stop here and report.
      // We expect 2 assets per configured block (image + audio)
      if (assets.length < blocks.filter(b => b.data).length * 2) { 
        setProcessingState(ProcessingState.Error);
        setErrorMessage(prev => prev || "Some media assets failed to generate. Please check logs for details.");
        return;
      }


      // 2. Generate SRT
      setProgressMsg("Calculating timings and generating Subtitles (SRT)...");
      logger.info("Generating SRT file...");
      const textMap = utils.mapRoteiroToTextMap(roteiro);
      try {
        const srtB64 = await utils.generateSRT(assets, textMap);
        assets.push({ block_id: 'legendas', type: 'srt', data_b64: srtB64 });
        logger.info("SRT generated successfully.");
      } catch (e) {
        logger.error("Failed to generate SRT", e);
        setErrorMessage(prev => prev + `Failed to generate SRT. `);
        setProcessingState(ProcessingState.Error);
        return;
      }

      // 3. Upload to Drive via GAS
      setProcessingState(ProcessingState.Uploading);
      setProgressMsg("Uploading bundle to Google Drive via GAS...");
      logger.info("Preparing payload for GAS upload.");
      
      const payload: JobPayload = {
        assets,
        roteiro,
        meta_dados: { data: dateStr, ref: reference },
        leitura_montada: roteiro.leitura?.text || "" // Now points to the specific block, with fallback
      };

      try {
        const returnedJobId = await gasService.sendJobToGAS(payload);
        setJobId(returnedJobId);
        setProcessingState(ProcessingState.Complete);
        setSuccessMessage("Content bundle uploaded successfully! Job ID: " + returnedJobId);
        logger.info(`Full automation complete. Job ID: ${returnedJobId}`);
      } catch (e: any) {
        logger.error("Failed to upload job to GAS", e);
        setErrorMessage(prev => prev + `Failed to upload job to Google Drive: ${e.message}`);
        setProcessingState(ProcessingState.Error);
      }

    } catch (e: any) {
      const msg = "Automation failed: " + e.message;
      setErrorMessage(msg);
      setProcessingState(ProcessingState.Error);
      logger.error(msg, e);
    }
  };

  const handleTestConnection = async () => {
      setProcessingState(ProcessingState.Uploading);
      setProgressMsg("Sending test packet to Google Apps Script...");
      setErrorMessage('');
      setSuccessMessage('');
      setQuotaExceededMessage(false);
      logger.info("Initiating GAS connection test.");

      try {
          const testJobId = await gasService.sendTestJob();
          setSuccessMessage(`Connection Verified! Test Job ID: ${testJobId}`);
          setProcessingState(ProcessingState.Idle);
          logger.info(`GAS connection test successful. Test Job ID: ${testJobId}`);
      } catch (e: any) {
          const msg = "Connection Test Failed: " + e.message;
          setErrorMessage(msg);
          setProcessingState(ProcessingState.Error);
          logger.error(msg, e);
      }
  };

  const handleSelectApiKey = async () => {
    try {
      await window.aistudio.openSelectKey();
      // Assume success, clear messages and allow retry
      setQuotaExceededMessage(false);
      setErrorMessage('');
      setProcessingState(ProcessingState.Idle);
      logger.info('User opened API key selection dialog. Resetting state.');
    } catch (e: any) {
      logger.error('Failed to open API key selection dialog', e);
      setErrorMessage('Failed to open API key selection dialog: ' + e.message);
    }
  }

  const copyToClipboard = (text: string, message: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setSuccessMessage(message);
      setTimeout(() => setSuccessMessage(''), 3000);
    }).catch(err => {
      setErrorMessage('Failed to copy text: ' + err.message);
      setTimeout(() => setErrorMessage(''), 3000);
    });
  };

  // --- Render Helpers ---

  const isBusy = processingState !== ProcessingState.Idle && processingState !== ProcessingState.Complete && processingState !== ProcessingState.Error;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-100 via-slate-50 to-white">
      <main className="w-full max-w-5xl bg-white shadow-2xl rounded-3xl p-6 md:p-10 border border-indigo-50/50">
        
        {/* Header */}
        <header className="text-center mb-10">
          <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600 tracking-tight mb-2">
            Monetiza Studio
          </h1>
          <p className="text-lg text-slate-500 font-medium">Automated Liturgical Content Factory</p>
        </header>

        {/* 1. Configuration Section */}
        <section className="bg-slate-50/80 p-6 rounded-2xl border border-slate-200 mb-8 backdrop-blur-sm">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <span className="bg-indigo-600 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm">1</span>
            Content Configuration
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Category</label>
              <select 
                value={category}
                onChange={(e) => setCategory(e.target.value)}
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
                onChange={(e) => setDateStr(e.target.value)}
                className="w-full p-3 bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                disabled={isBusy}
              />
            </div>

            <div className="lg:col-span-2">
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1 flex justify-between">
                  <span>Reference</span>
                  {fetchSource && <span className={`text-[10px] px-2 rounded-full ${fetchSource === 'API' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>Source: {fetchSource}</span>}
              </label>
              <input 
                type="text" 
                value={reference}
                readOnly
                placeholder={processingState === ProcessingState.FetchingLiturgy ? "Fetching (API or AI Search)..." : "Liturgical Reference"}
                className="w-full p-3 bg-slate-100 border border-slate-300 rounded-xl text-indigo-700 font-semibold"
              />
            </div>
            
            <div className="lg:col-span-2">
               <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Hook Style</label>
               <select 
                  value={introStyle}
                  onChange={(e) => setIntroStyle(e.target.value as IntroStyle)}
                  className="w-full p-3 bg-white border border-yellow-400 rounded-xl focus:ring-2 focus:ring-yellow-500 outline-none text-slate-700 font-medium"
                  disabled={isBusy}
               >
                 {Object.values(IntroStyle).map(s => <option key={s} value={s}>{s}</option>)}
               </select>
            </div>

            <div className="lg:col-span-2">
               <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Visual Style</label>
               <select 
                  value={visualStyle}
                  onChange={(e) => setVisualStyle(e.target.value as VisualStyle)}
                  className="w-full p-3 bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-slate-700 font-medium"
                  disabled={isBusy}
               >
                 {Object.values(VisualStyle).map(s => <option key={s} value={s}>{s}</option>)}
               </select>
            </div>

            {/* Fix: Add select for Video Resolution */}
            <div className="lg:col-span-4">
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Video Resolution</label>
              <select
                value={videoResolution}
                onChange={(e) => setVideoResolution(e.target.value)}
                className="w-full p-3 bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-slate-700 font-medium"
                disabled={isBusy}
              >
                <option value="9:16 (Vertical/Stories)">9:16 (Vertical/Stories)</option>
                <option value="16:9 (Horizontal/YouTube)">16:9 (Horizontal/YouTube)</option>
                <option value="1:1 (Quadrado/Feed)">1:1 (Quadrado/Feed)</option>
              </select>
            </div>
          </div>
        </section>

        {/* Action Button: Generate Script */}
        {!roteiro && (
           <div className="flex justify-center mb-8">
              <button
                onClick={handleGenerateScript}
                disabled={isBusy || !liturgy}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold py-4 px-10 rounded-full shadow-lg transform transition active:scale-95 flex items-center gap-3 text-lg"
              >
                {processingState === ProcessingState.GeneratingScript ? (
                   <>
                     <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                     Drafting Script...
                   </>
                ) : (
                   <>✨ Generate Script (Gemini)</>
                )}
              </button>
           </div>
        )}

        {/* 2. Script Editor & Preview */}
        {roteiro && (
          <section className="animate-fade-in-up">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <span className="bg-purple-600 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm">2</span>
                  Review & Finalize
                </h2>
                
                <div className="flex gap-4">
                  <select 
                    value={voice} 
                    onChange={(e) => setVoice(e.target.value as VoiceOption)}
                    className="p-2 border rounded-lg text-sm bg-white"
                    disabled={isBusy}
                  >
                    {Object.values(VoiceOption).map(v => <option key={v} value={v}>Voice: {v}</option>)}
                  </select>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 mb-8">
              <BlockCard 
                title="1. Abertura (Hook)" 
                color="primary"
                blockData={roteiro.hook || {text: '', prompt: ''}}
                onBlockDataChange={(data) => setRoteiro({...roteiro, hook: data})}
                readOnly={isBusy}
              />
              <BlockCard 
                title="2. Leitura (Liturgia)" 
                color="quaternary"
                blockData={roteiro.leitura || {text: '', prompt: ''}}
                onBlockDataChange={(data) => setRoteiro({...roteiro, leitura: data})}
                readOnly={isBusy}
              />
              <BlockCard 
                title="3. Reflexão" 
                color="secondary"
                blockData={roteiro.reflexao || {text: '', prompt: ''}}
                onBlockDataChange={(data) => setRoteiro({...roteiro, reflexao: data})}
                readOnly={isBusy}
              />
               <BlockCard 
                title="4. Aplicação" 
                color="tertiary"
                blockData={roteiro.aplicacao || {text: '', prompt: ''}}
                onBlockDataChange={(data) => setRoteiro({...roteiro, aplicacao: data})}
                readOnly={isBusy}
              />
              <BlockCard 
                title="5. Oração" 
                color="primary"
                blockData={roteiro.oracao || {text: '', prompt: ''}}
                onBlockDataChange={(data) => setRoteiro({...roteiro, oracao: data})}
                readOnly={isBusy}
              />
            </div>

            {/* 3. Final Action */}
            <div className="bg-slate-50 p-6 rounded-2xl border border-indigo-100 text-center">
               <h3 className="text-lg font-bold text-slate-700 mb-4">Ready for Production?</h3>
               <p className="text-sm text-slate-500 mb-6 max-w-lg mx-auto">
                 This will generate 5 AI Images (Imagen), 5 Audio clips (TTS), calculate Subtitles (SRT), and upload everything to the Video Factory Drive folder.
               </p>
               
               {jobId ? (
                 <div className="bg-green-100 border-2 border-green-500 text-green-800 p-6 rounded-xl animate-bounce-in">
                    <p className="font-bold text-lg mb-2">SUCCESS! JOB ID GENERATED:</p>
                    <p className="text-3xl font-mono select-all bg-white inline-block px-4 py-2 rounded shadow-sm">{jobId}</p>
                    <p className="text-sm mt-3">Copy this ID to your Python Video Builder.</p>
                 </div>
               ) : (
                <div className="flex flex-col gap-4 items-center">
                  <button
                    onClick={handleFullAutomation}
                    disabled={isBusy || quotaExceededMessage}
                    className="w-full md:w-auto bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 text-white font-bold py-4 px-12 rounded-full shadow-lg transform transition active:scale-95 text-xl flex flex-col items-center justify-center mx-auto"
                  >
                    {isBusy && processingState !== ProcessingState.Uploading ? (
                      <>
                        <div className="flex items-center gap-3">
                           <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                           Processing...
                        </div>
                        <span className="text-sm font-normal mt-1 opacity-90">{progressMsg}</span>
                      </>
                    ) : (
                      "🚀 GENERATE MEDIA & UPLOAD"
                    )}
                  </button>

                  <button
                    onClick={handleTestConnection}
                    disabled={isBusy || quotaExceededMessage}
                    className="text-slate-500 hover:text-indigo-600 text-xs underline mt-2"
                  >
                     {isBusy && processingState === ProcessingState.Uploading && progressMsg.includes("test") ? "Testing..." : "Test Drive Connection (Send Sample)"}
                  </button>
                </div>
               )}
            </div>
          </section>
        )}

        {/* Messages */}
        {successMessage && (
           <div className="fixed bottom-6 right-6 bg-green-100 border border-green-400 text-green-800 px-6 py-4 rounded-xl shadow-xl max-w-sm z-50 animate-bounce-in">
             <div className="font-bold mb-1">Success</div>
             <p className="text-sm">{successMessage}</p>
             <button onClick={() => setSuccessMessage('')} className="absolute top-2 right-2 text-green-600 hover:text-green-800">✕</button>
          </div>
        )}

        {errorMessage && (
          <div className="fixed bottom-6 right-6 bg-red-100 border border-red-400 text-red-700 px-6 py-4 rounded-xl shadow-xl max-w-sm z-50 animate-bounce-in">
             <div className="font-bold mb-1">Error</div>
             <p className="text-sm">{errorMessage}</p>
             <button onClick={() => setErrorMessage('')} className="absolute top-2 right-2 text-red-400 hover:text-red-700">✕</button>
          </div>
        )}

        {quotaExceededMessage && (
          <div className="fixed bottom-6 right-6 bg-yellow-100 border border-yellow-400 text-yellow-800 px-6 py-4 rounded-xl shadow-xl max-w-sm z-50 animate-bounce-in">
            <div className="font-bold mb-1">API Quota Exceeded</div>
            <p className="text-sm mb-4">You've hit the usage limit for a Gemini API. A paid API key is required for this operation.</p>
            <button
              onClick={handleSelectApiKey}
              className="w-full bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded-full transition active:scale-95 text-base"
            >
              Select / Configure API Key
            </button>
            <p className="text-sm text-yellow-700 underline mt-2">
              <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer">
                Learn more about billing.
              </a>
            </p>
            <button onClick={() => setQuotaExceededMessage(false)} className="absolute top-2 right-2 text-yellow-600 hover:text-yellow-800">✕</button>
          </div>
        )}
        
        {/* Developer Tools */}
        <div className="mt-10 pt-6 border-t border-slate-200">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <span className="bg-orange-500 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm">🛠️</span>
              Developer Tools
            </h2>
            <button
              onClick={() => setShowDeveloperTools(!showDeveloperTools)}
              className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm"
            >
              {showDeveloperTools ? 'Hide Tools' : 'Show Tools'}
            </button>
          </div>

          {showDeveloperTools && (
            <div className="space-y-6 animate-fade-in-up">
              {/* Google Apps Script Code Viewer */}
              <div className="bg-slate-100 p-4 rounded-lg border border-slate-200">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-bold text-lg text-slate-700">Google Apps Script (`Code.gs`)</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowGasCode(!showGasCode)}
                      className="bg-slate-300 hover:bg-slate-400 text-slate-800 px-3 py-1 rounded-md text-xs"
                    >
                      {showGasCode ? 'Hide Code' : 'Show Code'}
                    </button>
                    <button
                      onClick={() => copyToClipboard(gasCode, 'GAS Code copied!')}
                      className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-md text-xs"
                    >
                      Copy Code
                    </button>
                  </div>
                </div>
                {showGasCode && (
                  <textarea
                    readOnly
                    rows={20}
                    className="w-full p-3 bg-slate-900 text-green-300 font-mono text-xs rounded-md custom-scrollbar resize-y"
                    value={gasCode}
                  ></textarea>
                )}
              </div>

              {/* Python App Code Viewer */}
              <div className="bg-slate-100 p-4 rounded-lg border border-slate-200">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-bold text-lg text-slate-700">Python App (`app.py`)</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowPythonCode(!showPythonCode)}
                      className="bg-slate-300 hover:bg-slate-400 text-slate-800 px-3 py-1 rounded-md text-xs"
                    >
                      {showPythonCode ? 'Hide Code' : 'Show Code'}
                    </button>
                    <button
                      onClick={() => copyToClipboard(pythonAppCode, 'Python App Code copied!')}
                      className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-md text-xs"
                    >
                      Copy Code
                    </button>
                  </div>
                </div>
                {showPythonCode && (
                  <textarea
                    readOnly
                    rows={20}
                    className="w-full p-3 bg-slate-900 text-cyan-300 font-mono text-xs rounded-md custom-scrollbar resize-y"
                    value={pythonAppCode}
                  ></textarea>
                )}
              </div>

              {/* Activity Logs (moved here) */}
              <div className="bg-slate-100 p-4 rounded-lg border border-slate-200">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="font-bold text-lg text-slate-700">Activity Logs</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowLogs(!showLogs)}
                      className="bg-slate-300 hover:bg-slate-400 text-slate-800 px-3 py-1 rounded-md text-xs"
                    >
                      {showLogs ? 'Hide Logs' : 'Show Logs'}
                    </button>
                    {showLogs && (
                      <>
                        <button
                          onClick={() => logger.clearLogs()}
                          className="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1 rounded-md text-xs"
                        >
                          Clear
                        </button>
                        <button
                          onClick={() => logger.downloadLogs()}
                          className="bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1 rounded-md text-xs"
                        >
                          Download
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {showLogs && (
                  <div className="bg-slate-900 text-white text-xs p-4 rounded-lg h-64 overflow-y-scroll font-mono custom-scrollbar">
                    {logs.length === 0 ? (
                      <p className="text-slate-500">No logs yet.</p>
                    ) : (
                      logs.map((log, index) => (
                        <p key={index} className={log.level === 'ERROR' ? 'text-red-400' : log.level === 'WARN' ? 'text-yellow-400' : 'text-slate-300'}>
                          <span className="text-slate-600">{log.timestamp}</span> {log.level}: {log.message}
                        </p>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

      </main>
    </div>
  );
};

export default App;