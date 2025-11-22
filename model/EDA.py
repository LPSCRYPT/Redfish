# Exploratory Data Analysis

import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np
import os

DATA_PATH = 'data/transaction_dataset.csv'

def print_info(df):
    print("DataFrame Info:")
    print(df.info())
    print("\nStatistical Summary:")
    print(df.describe())
    print("\nMissing Values:")
    print(df.isnull().sum())
    print("\nFirst 5 Rows:")
    print(df.head())


def save_image(fig, filename):
    os.makedirs('images', exist_ok=True)
    fig.savefig(os.path.join('images', filename))


def inspect_flag_distribution(df, flag_column):
    # Inspect target distribution
    print(df[flag_column].value_counts())
    pie, ax = plt.subplots(figsize=[15,10])
    labels = ['Non-fraud', 'Fraud']
    colors = ['#f9ae35', '#f64e38']
    plt.pie(x = df[flag_column].value_counts(), autopct='%.2f%%', explode=[0.02]*2, labels=labels, pctdistance=0.5, textprops={'fontsize': 14}, colors = colors)
    plt.title('Target distribution')
    plt.show()
    save_image(pie, "flag_distribution.png")


def correlation_heatmap(df, annotation=False):
    # Correlation matrix
    numericals = df.select_dtypes(include=['float','int']).columns
    corr = df[numericals].corr()

    mask = np.zeros_like(corr)
    mask[np.triu_indices_from(mask)]=True
    with sns.axes_style('white'):
        fig, ax =plt.subplots(figsize=(20,12))
        sns.heatmap(corr,  mask=mask, annot=False, cmap='coolwarm', center=0, square=True)
        plt.title('Correlation Heatmap', fontsize=10)
        plt.show()
        save_image(fig, "correlation_heatmap.png")


def main():
    df = pd.read_csv(DATA_PATH)
    print_info(df)
    inspect_flag_distribution(df, 'FLAG')
    correlation_heatmap(df, annotation=False)

if __name__ == "__main__":
    main()