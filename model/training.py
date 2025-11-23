import numpy as np
import pandas as pd
from pyparsing import Dict
import seaborn as sns
import torch
import xgboost as xgb
from hummingbird.ml import convert
from imblearn.over_sampling import SMOTE
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import PowerTransformer
from pathlib import Path
import os

DATA_PATH = Path(__file__).resolve().parent / 'data' / 'data.csv'

def load_dataset(csv_path: Path):
    df = pd.read_csv(csv_path)
    print(f"Loaded dataset: {df.shape}")
    # Drop auto-generated index columns if present
    if 'Unnamed: 0' in df.columns:
        df = df.drop(columns=['Unnamed: 0'])
    return df


def split_dataset(df: pd.DataFrame, test_size: float = 0.2, random_state: int =42):
    y = df['FLAG']
    X = df.drop(columns=['FLAG'])
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=random_state
    )
    print(f"Train shapes: {X_train.shape}, {y_train.shape}")
    print(f"Test shapes: {X_test.shape}, {y_test.shape}")
    return X_train, X_test, y_train, y_test


def scale_features(X_train: pd.DataFrame, X_test: pd.DataFrame):
    norm = PowerTransformer()
    norm_train = norm.fit_transform(X_train)
    norm_test = norm.transform(X_test)
    print("Applied PowerTransformer normalization")
    return norm_train, norm_test, norm


def balance_training_data(X_train: np.ndarray, y_train: pd.Series):
    smote = SMOTE()
    X_resampled, y_resampled = smote.fit_resample(X_train, y_train)
    print(
        f"SMOTE applied: before {X_train.shape}/{y_train.shape},",
        f"after {X_resampled.shape}/{y_resampled.shape}"
    )
    return X_resampled, y_resampled


def train_models(X_train: np.ndarray, y_train: np.ndarray):
    models: Dict[str, object] = {}

    rf_model = RandomForestClassifier(random_state=42)
    rf_model.fit(X_train, y_train)
    models['random_forest'] = rf_model
    print("Trained RandomForestClassifier")

    xgb_model = xgb.XGBClassifier(random_state=42)
    xgb_model.fit(X_train, y_train)
    models['xgboost'] = xgb_model
    print("Trained XGBoost classifier")

    return models


def evaluate_model(name: str, model: object, X_test: np.ndarray, y_test: pd.Series):
    preds = model.predict(X_test)
    print(f"\n{name} classification report:\n{classification_report(y_test, preds)}")
    print(f"{name} confusion matrix:\n{confusion_matrix(y_test, preds)}")


def export_model_to_onnx(model: xgb.XGBClassifier, sample: np.ndarray, export_path: Path):
    os.makedirs(export_path.parent, exist_ok=True)
    hb_model = convert(model, 'torch', sample)
    torch_model = hb_model.model
    dummy_input = torch.tensor(sample, dtype=torch.float32)

    torch.onnx.export(
        torch_model,
        dummy_input,
        export_path.as_posix(),
        export_params=True,
        opset_version=10,
        do_constant_folding=True,
        input_names=['input'],
        output_names=['output'],
        dynamic_axes={'input': {0: 'batch_size'}, 'output': {0: 'batch_size'}},
    )

    print(f"✅ Model exported to {export_path}")
    return export_path


def main():
    print(torch.__version__)

    df = load_dataset(DATA_PATH)

    X_train, X_test, y_train, y_test = split_dataset(df)
    norm_train, norm_test, _ = scale_features(X_train, X_test)
    X_resampled, y_resampled = balance_training_data(norm_train, y_train)

    models = train_models(X_resampled, y_resampled)

    evaluate_model('RandomForest', models['random_forest'], norm_test, y_test)
    evaluate_model('XGBoost', models['xgboost'], norm_test, y_test)

    export_model_to_onnx(
        models['xgboost'],
        norm_test[:1],
        Path(__file__).resolve().parent / 'onnx' / 'xgboost_model.onnx'
    )

    export_model_to_onnx(
        models['random_forest'],
        norm_test[:1],
        Path(__file__).resolve().parent / 'onnx' / 'random_forest_model.onnx'
    )


if __name__ == '__main__':
    main()