from app.layout import names_from_layout, unique_labels


def test_unique_labels_skips_blank_and_casefold_dupes():
    assert unique_labels([" A01 ", "", "A02", "a01", "A03"]) == ["A01", "A02", "A03"]


def test_names_from_layout_reads_rows_and_rack_row_names():
    names = names_from_layout(
        {
            "rows": [{"name": "A12"}, {"name": ""}, "A13"],
            "racks": [{"name": "R1", "row_name": "A14"}, {"name": "R2"}],
        }
    )
    assert names == ["A12", "A13", "A14"]
