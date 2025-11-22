"""Preprocessing to prepare the data."""

from pathlib import Path
import pandas as pd

DATA_PATH = 'data/transaction_dataset.csv'
CLEAN_DATA_PATH = 'data/data.csv'

DROP_COLUMNS = [
    'total transactions (including tnx to create contract',
    'total ether sent contracts',
    'max val sent to contract',
    ' ERC20 avg val rec',
    ' ERC20 avg val rec',
    ' ERC20 max val rec',
    ' ERC20 min val rec',
    ' ERC20 uniq rec contract addr',
    'max val sent',
    ' ERC20 avg val sent',
    ' ERC20 min val sent',
    ' ERC20 max val sent',
    ' Total ERC20 tnxs',
    'avg value sent to contract',
    'Unique Sent To Addresses',
    'Unique Received From Addresses',
    'total ether received',
    ' ERC20 uniq sent token name',
    'min value received',
    'min val sent',
    ' ERC20 uniq rec addr',
    'min value sent to contract',
    ' ERC20 uniq sent addr.1',
]

# Load dataset from CSV file
def load_dataset(csv_path: Path) -> pd.DataFrame:
    df = pd.read_csv(csv_path, index_col=0)
    print(f"Loaded dataset: {df.shape}")
    return df


# Clean dataset
def clean_dataset(df: pd.DataFrame) -> pd.DataFrame:
    cleaned = df.iloc[:, 2:].copy()
    categorical_cols = cleaned.select_dtypes(include=['object']).columns
    if len(categorical_cols) > 0:
        print(f"Dropping {len(categorical_cols)} categorical columns")
        cleaned.drop(columns=categorical_cols, inplace=True)

    cleaned.fillna(cleaned.median(numeric_only=True), inplace=True)

    zero_var_cols = cleaned.columns[cleaned.var(numeric_only=True) == 0]
    if len(zero_var_cols) > 0:
        print(f"Dropping {len(zero_var_cols)} zero-variance columns")
        cleaned.drop(columns=zero_var_cols, inplace=True)

    manual_cols = [col for col in DROP_COLUMNS if col in cleaned.columns]
    if manual_cols:
        print(f"Dropping {len(manual_cols)} manually selected columns")
        cleaned.drop(columns=manual_cols, inplace=True)

    print(f"Cleaned dataset: {cleaned.shape}")
    return cleaned


# Save cleaned dataset to CSV file
def save_cleaned_dataset(df: pd.DataFrame, output_path: Path):
    df.to_csv(output_path, index=True)
    print(f"Saved cleaned dataset to {output_path}")


def main():
    df = load_dataset(Path(DATA_PATH))
    df = clean_dataset(df)
        #print dataset info
    print("Cleaned DataFrame Info:")
    print(df.info())
    save_cleaned_dataset(df, Path(CLEAN_DATA_PATH))


if __name__ == "__main__":
    main()