"""Build compact, exact dashboard aggregates from the supplied workbook."""
from __future__ import annotations

import json
import argparse
import gzip
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("workbook", type=Path, help="Path to the assessment data.xlsx workbook")
SOURCE = parser.parse_args().workbook
OUT = ROOT / "data"
OUT.mkdir(parents=True, exist_ok=True)

df = pd.read_excel(SOURCE, sheet_name="Sheet1")
df["day"] = pd.to_datetime(df["Order_Datetime"]).dt.strftime("%Y-%m-%d")
df["revenue"] = df["Price"] * df["Quantity"]

fields = {
    "outlet": "Outlet_Name",
    "group": "Group",
    "item": "Item",
    "orderType": "Order_Type",
    "settlement": "Settlement",
}
for key, source in fields.items():
    df[key] = df[source].astype(str)

line_dims = ["day", "outlet", "group", "item", "orderType", "settlement"]
lines = (
    df.groupby(line_dims, sort=True, observed=True)
    .agg(revenue=("revenue", "sum"), quantity=("Quantity", "sum"), lineItems=("BillNo", "size"))
    .reset_index()
)

groups = sorted(df["group"].unique())
items = sorted(df["item"].unique())
group_bit = {name: 1 << i for i, name in enumerate(groups)}
item_bit = {name: 1 << i for i, name in enumerate(items)}

"""Compress distinct product memberships into bit masks on each order."""
order_base = df.groupby("BillNo", sort=False, observed=True).agg(
    day=("day", "first"), outlet=("outlet", "first"), orderType=("orderType", "first"),
    settlement=("settlement", "first"), revenue=("revenue", "sum"),
    quantity=("Quantity", "sum"), lineItems=("BillNo", "size"),
)
group_masks = df[["BillNo", "group"]].drop_duplicates().assign(bit=lambda x: x["group"].map(group_bit)).groupby("BillNo")["bit"].sum()
item_masks = df[["BillNo", "item"]].drop_duplicates().assign(bit=lambda x: x["item"].map(item_bit)).groupby("BillNo")["bit"].sum()
order_base["groupMask"] = group_masks
order_base["itemMask"] = item_masks
order_df = order_base.reset_index()
order_dims = ["day", "outlet", "orderType", "settlement", "groupMask", "itemMask"]
order_cube = (
    order_df.groupby(order_dims, sort=True, observed=True)
    .agg(orders=("revenue", "size"), revenue=("revenue", "sum"), quantity=("quantity", "sum"), lineItems=("lineItems", "sum"))
    .reset_index()
)

days = sorted(df["day"].unique())
outlets = sorted(df["outlet"].unique())
order_types = sorted(df["orderType"].unique())
settlements = sorted(df["settlement"].unique())
day_id = {name: i for i, name in enumerate(days)}
outlet_id = {name: i for i, name in enumerate(outlets)}
group_id = {name: i for i, name in enumerate(groups)}
item_id = {name: i for i, name in enumerate(items)}
type_id = {name: i for i, name in enumerate(order_types)}
settlement_id = {name: i for i, name in enumerate(settlements)}

# Columnar dictionaries + integer-coded tuple rows keep the downloadable
# aggregate small. No source line or bill identifiers are sent to the browser.
line_rows = [
    [day_id[r.day], outlet_id[r.outlet], group_id[r.group], item_id[r.item], type_id[r.orderType], settlement_id[r.settlement], int(r.revenue), int(r.quantity), int(r.lineItems)]
    for r in lines.itertuples(index=False)
]
order_rows = [
    [day_id[r.day], outlet_id[r.outlet], type_id[r.orderType], settlement_id[r.settlement], int(r.groupMask), int(r.itemMask), int(r.orders), int(r.revenue), int(r.quantity), int(r.lineItems)]
    for r in order_cube.itertuples(index=False)
]

payload = {
    "meta": {
        "sourceSheet": "Sheet1",
        "lineItems": int(len(df)),
        "orderCount": int(df["BillNo"].nunique()),
        "dateMin": str(df["day"].min()),
        "dateMax": str(df["day"].max()),
        "outlets": outlets,
        "groups": groups,
        "items": items,
        "orderTypes": order_types,
        "settlements": settlements,
        "brands": sorted(df["Brand"].astype(str).unique()),
        "revenue": int(df["revenue"].sum()),
        "quantity": int(df["Quantity"].sum()),
        "zeroPriceLineItems": int(df["Price"].eq(0).sum()),
        "groupBits": group_bit,
        "itemBits": item_bit,
    },
    "days": days,
    "lines": line_rows,
    "orders": order_rows,
}
raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
target = OUT / "dashboard.json.gz"
with target.open("wb") as file:
    with gzip.GzipFile(fileobj=file, mode="wb", mtime=0, compresslevel=9) as zipped:
        zipped.write(raw)
print(json.dumps({"lines": len(df), "lineCube": len(lines), "orderCount": len(order_df), "orderCube": len(order_cube), "bytesUncompressed": len(raw), "bytesGzip": target.stat().st_size, "revenue": payload["meta"]["revenue"]}))
