import pandas as pd


def to_million_won_display(df: pd.DataFrame, columns=("전기", "당기")) -> pd.DataFrame:
    display_df = df.copy()
    for col in columns:
        if col in display_df.columns:
            display_df[col] = (
                (display_df[col] / 1_000_000)
                .round(0)
                .astype("int64")
                .apply(lambda v: f"{v:,}")
            )
    return display_df
