from app.search import fold_separators, text_matches


def test_fold_separators_strips_space_hyphen_underscore_dot():
    assert fold_separators("ABC-123") == "ABC123"
    assert fold_separators("ABC 123") == "ABC123"
    assert fold_separators("ABC_123") == "ABC123"
    assert fold_separators("ABC.123") == "ABC123"
    assert fold_separators("ABC123") == "ABC123"
    assert fold_separators("  ABC - 123 ") == "ABC123"


def test_text_matches_treats_tag_placeholders_as_equivalent():
    assert text_matches("ABC-123", "ABC 123")
    assert text_matches("ABC-123", "ABC123")
    assert text_matches("ABC123", "ABC-123")
    assert text_matches("ABC_123", "ABC.123")
    assert text_matches("serial CH-VIEW", "CH VIEW")
    assert not text_matches("ABC-123", "XYZ-999")
    assert not text_matches("ABC-123", "")
