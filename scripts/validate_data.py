"""Verify the aggregate cubes reconcile to the source workbook totals."""
import argparse
import gzip
import json
from pathlib import Path

import pandas as pd

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("workbook", type=Path)
args = parser.parse_args()
source = pd.read_excel(args.workbook, sheet_name="Sheet1")
with gzip.open(root / "public" / "data" / "dashboard.json.gz", "rt", encoding="utf-8") as f:
    payload = json.load(f)
meta = payload["meta"]
line_revenue = sum(row[6] for row in payload["lines"])
line_quantity = sum(row[7] for row in payload["lines"])
line_count = sum(row[8] for row in payload["lines"])
order_count = sum(row[6] for row in payload["orders"])
order_revenue = sum(row[7] for row in payload["orders"])
assert line_count == len(source) == meta["lineItems"] == 300_000
assert order_count == source["BillNo"].nunique() == meta["orderCount"] == 110_478
assert line_revenue == order_revenue == int((source["Price"] * source["Quantity"]).sum()) == meta["revenue"] == 69_480_952
assert line_quantity == int(source["Quantity"].sum()) == meta["quantity"] == 434_448
assert meta["zeroPriceLineItems"] == int(source["Price"].eq(0).sum()) == 8_611
source["order_day"] = pd.to_datetime(source["Order_Datetime"]).dt.strftime("%Y-%m-%d")
by_bill = source.groupby("BillNo")
for column in ["Outlet_Name", "Order_Type", "Settlement", "order_day"]:
    assert int(by_bill[column].nunique().gt(1).sum()) == 0, f"Order has inconsistent {column}"

days = payload["days"]
line_frame = pd.DataFrame(payload["lines"], columns=["day", "outlet", "group", "item", "orderType", "settlement", "revenue", "quantity", "lineItems"])
order_frame = pd.DataFrame(payload["orders"], columns=["day", "outlet", "orderType", "settlement", "groupMask", "itemMask", "orders", "revenue", "quantity", "lineItems"])
line_names = {"day": days, "outlet": meta["outlets"], "group": meta["groups"], "item": meta["items"], "orderType": meta["orderTypes"], "settlement": meta["settlements"]}
line_indices = {key: {value: i for i, value in enumerate(values)} for key, values in line_names.items()}
order_dims = {"day": "order_day", "outlet": "Outlet_Name", "orderType": "Order_Type", "settlement": "Settlement"}
cases = [
    {"day": "2025-08-08"}, {"outlet": "Koramangala"}, {"group": "Burgers"},
    {"item": "Spicy Zinger Burger"}, {"orderType": "Dine-In"}, {"settlement": "ZomatoPay"},
    {"outlet": "Koramangala", "group": "Burgers", "item": "Spicy Zinger Burger", "orderType": "Delivery", "settlement": "ZomatoPay", "day": "2026-01-15"},
]
for selection in cases:
    expected = source
    for key, value in selection.items():
        source_key = order_dims.get(key, {"group": "Group", "item": "Item"}.get(key, key))
        expected = expected[expected[source_key] == value]
    line_filter = pd.Series(True, index=line_frame.index)
    order_filter = pd.Series(True, index=order_frame.index)
    for key, value in selection.items():
        line_filter &= line_frame[key] == line_indices[key][value]
        if key in order_dims:
            order_filter &= order_frame[key] == line_indices[key][value]
    if "group" in selection:
        order_filter &= (order_frame["groupMask"] & meta["groupBits"][selection["group"]]) != 0
    if "item" in selection:
        order_filter &= (order_frame["itemMask"] & meta["itemBits"][selection["item"]]) != 0
    filtered_lines = line_frame[line_filter]
    filtered_orders = order_frame[order_filter]
    assert int(filtered_lines["revenue"].sum()) == int((expected["Price"] * expected["Quantity"]).sum())
    assert int(filtered_lines["quantity"].sum()) == int(expected["Quantity"].sum())
    assert int(filtered_lines["lineItems"].sum()) == len(expected)
    assert int(filtered_orders["orders"].sum()) == int(expected["BillNo"].nunique())

print(json.dumps({"lineItems": line_count, "orders": order_count, "revenue": line_revenue, "quantity": line_quantity, "zeroPriceLineItems": meta["zeroPriceLineItems"], "filterCases": len(cases), "reconciled": True}))
