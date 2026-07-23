import io
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

import pandas as pd
import requests
import streamlit as st

BASE_URL = "https://opendart.fss.or.kr/api"
CORP_CODE_CACHE = Path("data/corpCode.xml")

SJ_DIV_MAP = {
    "BS": "재무상태표",
    "IS": "손익계산서",
    "CIS": "포괄손익계산서",
    "CF": "현금흐름표",
    "SCE": "자본변동표",
}

REPRT_CODE_LABELS = {
    "11011": "사업보고서",
    "11012": "반기보고서",
    "11014": "3분기보고서",
    "11013": "1분기보고서",
}

FS_DIV_LABELS = {
    "OFS": "개별재무제표",
    "CFS": "연결재무제표",
}


@st.cache_data(show_spinner="기업 목록 불러오는 중...")
def load_corp_code_map(api_key: str) -> pd.DataFrame:
    if CORP_CODE_CACHE.exists():
        xml_bytes = CORP_CODE_CACHE.read_bytes()
    else:
        resp = requests.get(f"{BASE_URL}/corpCode.xml", params={"crtfc_key": api_key}, timeout=30)
        resp.raise_for_status()
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            xml_bytes = zf.read("CORPCODE.xml")
        CORP_CODE_CACHE.parent.mkdir(parents=True, exist_ok=True)
        CORP_CODE_CACHE.write_bytes(xml_bytes)

    root = ET.fromstring(xml_bytes)
    rows = []
    for item in root.findall("list"):
        rows.append(
            {
                "corp_code": item.findtext("corp_code"),
                "corp_name": item.findtext("corp_name"),
                "stock_code": (item.findtext("stock_code") or "").strip(),
                "modify_date": item.findtext("modify_date"),
            }
        )
    return pd.DataFrame(rows)


def search_corp(corp_df: pd.DataFrame, keyword: str) -> pd.DataFrame:
    if not keyword:
        return corp_df.iloc[0:0]
    return corp_df[corp_df["corp_name"].str.contains(keyword, na=False)]


def fetch_financial_statements(
    api_key: str,
    corp_code: str,
    bsns_year: str,
    reprt_code: str = "11011",
    fs_div: str = "OFS",
) -> pd.DataFrame:
    resp = requests.get(
        f"{BASE_URL}/fnlttSinglAcntAll.json",
        params={
            "crtfc_key": api_key,
            "corp_code": corp_code,
            "bsns_year": bsns_year,
            "reprt_code": reprt_code,
            "fs_div": fs_div,
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("status") != "000":
        raise ValueError(f"DART API 오류 {data.get('status')}: {data.get('message')}")
    return pd.DataFrame(data["list"])


def normalize_dart_financials(raw_df: pd.DataFrame) -> dict:
    result = {}
    for sj_code, name in SJ_DIV_MAP.items():
        subset = raw_df[raw_df["sj_div"] == sj_code]
        if subset.empty:
            continue
        table = subset[["account_nm", "frmtrm_amount", "thstrm_amount"]].copy()
        table.columns = ["계정과목", "전기", "당기"]
        for col in ["전기", "당기"]:
            table[col] = pd.to_numeric(
                table[col].astype(str).str.replace(",", ""), errors="coerce"
            ).fillna(0)
        result[name] = table.reset_index(drop=True)
    return result
