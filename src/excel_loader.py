import pandas as pd

STATEMENT_SHEETS = ["재무상태표", "손익계산서", "현금흐름표"]
JOURNAL_SHEET = "전표데이터"


def load_excel_template(file) -> dict:
    result = {}
    for sheet in STATEMENT_SHEETS:
        df = pd.read_excel(file, sheet_name=sheet)
        df = df.rename(
            columns={df.columns[0]: "계정과목", df.columns[1]: "전기", df.columns[2]: "당기"}
        )
        for col in ["전기", "당기"]:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
        result[sheet] = df
    return result


def load_journal_sheet(file) -> pd.DataFrame:
    return pd.read_excel(file, sheet_name=JOURNAL_SHEET)
