import csv

PATH = "data/seoul_apt_2026H1.csv"
TARGET_GU = "마포구"
TOP_N = 5


def load_rows(path):
    with open(path, newline="", encoding="cp949") as f:
        reader = csv.DictReader(f)
        return list(reader)


def main():
    rows = load_rows(PATH)

    deals = [
        row for row in rows
        if row["자치구명"] == TARGET_GU
    ]

    deals.sort(
        key=lambda row: int(row["물건금액(만원)"].replace(",", "")),
        reverse=True,
    )

    print(f"{TARGET_GU} 물건금액 상위 {TOP_N}건")
    for row in deals[:TOP_N]:
        print(f"{row['건물명']} | {row['물건금액(만원)']}만원 | {row['계약일']}")


if __name__ == "__main__":
    main()
