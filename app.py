import os
from pathlib import Path

import streamlit as st
from dotenv import load_dotenv

from src.dart_api import (
    FS_DIV_LABELS,
    REPRT_CODE_LABELS,
    fetch_financial_statements,
    load_corp_code_map,
    normalize_dart_financials,
    search_corp,
)
from src.excel_loader import load_excel_template, load_journal_sheet
from src.formatting import to_million_won_display

load_dotenv()
DART_API_KEY = os.getenv("DART_API_KEY", "")

st.set_page_config(page_title="회계감사 AI 분석 도구", layout="wide")
st.title("회계감사 AI 분석 도구")
st.caption("전수 데이터 기반 이상거래 탐지 · 재무제표 자동 분석 · 감사 체크리스트 생성")

if "financials" not in st.session_state:
    st.session_state["financials"] = None
if "journal" not in st.session_state:
    st.session_state["journal"] = None

st.sidebar.header("데이터 입력")
source = st.sidebar.radio("입력 방식", ["DART 공시자료 조회", "엑셀 직접 업로드"])

if source == "DART 공시자료 조회":
    if not DART_API_KEY:
        st.sidebar.error(".env에 DART_API_KEY가 설정되어 있지 않습니다.")
    else:
        keyword = st.sidebar.text_input("기업명 검색 (예: 삼성전자)")
        if keyword:
            corp_df = load_corp_code_map(DART_API_KEY)
            matches = search_corp(corp_df, keyword).head(30)
            if matches.empty:
                st.sidebar.warning("검색 결과가 없습니다.")
            else:
                labels = [
                    f"{row.corp_name} ({row.stock_code or '비상장'})"
                    for row in matches.itertuples()
                ]
                selected_label = st.sidebar.selectbox("기업 선택", labels)
                selected_row = matches.iloc[labels.index(selected_label)]

                bsns_year = st.sidebar.text_input("사업연도(4자리)", value="2025")
                reprt_code = st.sidebar.selectbox(
                    "보고서 종류",
                    options=list(REPRT_CODE_LABELS.keys()),
                    format_func=lambda x: REPRT_CODE_LABELS[x],
                )
                fs_div = st.sidebar.selectbox(
                    "재무제표 종류",
                    options=list(FS_DIV_LABELS.keys()),
                    format_func=lambda x: FS_DIV_LABELS[x],
                )

                if st.sidebar.button("재무제표 불러오기"):
                    try:
                        raw = fetch_financial_statements(
                            DART_API_KEY,
                            selected_row["corp_code"],
                            bsns_year,
                            reprt_code,
                            fs_div,
                        )
                        st.session_state["financials"] = normalize_dart_financials(raw)
                        st.session_state["journal"] = None
                        st.sidebar.success(f"{selected_row['corp_name']} 재무제표를 불러왔습니다.")
                    except Exception as e:
                        st.sidebar.error(f"오류: {e}")
else:
    uploaded = st.sidebar.file_uploader("표준 템플릿(financial_template.xlsx) 업로드", type=["xlsx"])
    if uploaded:
        try:
            st.session_state["financials"] = load_excel_template(uploaded)
            try:
                st.session_state["journal"] = load_journal_sheet(uploaded)
            except Exception:
                st.session_state["journal"] = None
            st.sidebar.success("엑셀 데이터를 불러왔습니다.")
        except Exception as e:
            st.sidebar.error(f"업로드 오류: {e}")

    template_path = Path("templates/financial_template.xlsx")
    if template_path.exists():
        st.sidebar.download_button(
            "표준 템플릿 다운로드",
            data=template_path.read_bytes(),
            file_name="financial_template.xlsx",
        )

st.divider()

if st.session_state["financials"]:
    tabs = st.tabs(list(st.session_state["financials"].keys()))
    for tab, (name, df) in zip(tabs, st.session_state["financials"].items()):
        with tab:
            st.caption("단위: 백만원")
            st.dataframe(to_million_won_display(df), use_container_width=True, hide_index=True)
    if st.session_state["journal"] is not None:
        with st.expander("전표데이터 미리보기"):
            st.dataframe(st.session_state["journal"], use_container_width=True, hide_index=True)
else:
    st.info("왼쪽에서 DART 조회 또는 엑셀 업로드로 재무제표 데이터를 불러오세요.")
