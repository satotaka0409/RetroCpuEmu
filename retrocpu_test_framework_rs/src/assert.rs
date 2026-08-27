use std::fmt::Debug;

use crate::error::FrameworkError;

pub fn assert_equal<T>(actual: T, expected: T, label: Option<&str>) -> Result<(), FrameworkError>
where
    T: PartialEq + Debug,
{
    if actual != expected {
        return Err(FrameworkError::invalid_argument(format!(
            "{}: expected {:?}, got {:?}",
            label.unwrap_or("assertEqual"),
            expected,
            actual
        )));
    }
    Ok(())
}

pub fn assert_contain_str(
    haystack: &str,
    needle: &str,
    label: Option<&str>,
) -> Result<(), FrameworkError> {
    if !haystack.contains(needle) {
        return Err(FrameworkError::invalid_argument(format!(
            "{}: '{}' does not contain '{}'",
            label.unwrap_or("assertContain"),
            haystack,
            needle
        )));
    }
    Ok(())
}

pub fn assert_contain_vec<T>(
    haystack: &[T],
    needle: &T,
    label: Option<&str>,
) -> Result<(), FrameworkError>
where
    T: PartialEq + Debug,
{
    if !haystack.iter().any(|x| x == needle) {
        return Err(FrameworkError::invalid_argument(format!(
            "{}: array does not contain {:?}",
            label.unwrap_or("assertContain"),
            needle
        )));
    }
    Ok(())
}

pub fn assert_throw(
    f: impl FnOnce() -> Result<(), FrameworkError>,
    contains: Option<&str>,
    label: Option<&str>,
) -> Result<(), FrameworkError> {
    match f() {
        Ok(_) => Err(FrameworkError::invalid_argument(format!(
            "{}: expected throw",
            label.unwrap_or("assertThrow")
        ))),
        Err(e) => {
            if let Some(pattern) = contains {
                let msg = format!("{e}");
                if !msg.contains(pattern) {
                    return Err(FrameworkError::invalid_argument(format!(
                        "{}: threw '{}', expected to contain '{}'",
                        label.unwrap_or("assertThrow"),
                        msg,
                        pattern
                    )));
                }
            }
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equal_and_contain() {
        assert_equal(1_u8, 1_u8, None).expect("equal");
        assert_contain_str("abc", "b", None).expect("contain str");
        assert_contain_vec(&[1_u8, 2_u8], &2_u8, None).expect("contain vec");
    }

    #[test]
    fn throw_check() {
        let ok = assert_throw(
            || Err(FrameworkError::invalid_argument("boom")),
            Some("boom"),
            None,
        );
        assert!(ok.is_ok());
    }
}