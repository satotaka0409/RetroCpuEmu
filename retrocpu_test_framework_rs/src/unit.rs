use std::fmt::Debug;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Mutex, OnceLock};

use crate::cpu_log_mark::{begin_cpu_log_test, end_cpu_log_test};
use crate::error::FrameworkError;

pub struct UnitCase {
    pub name: String,
    pub run: Box<dyn Fn() -> Result<(), FrameworkError> + Send + Sync>,
}

fn registry() -> &'static Mutex<Vec<UnitCase>> {
    static REGISTRY: OnceLock<Mutex<Vec<UnitCase>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(Vec::new()))
}

pub fn test(
    name: impl Into<String>,
    f: impl Fn() -> Result<(), FrameworkError> + Send + Sync + 'static,
) {
    let name_s = name.into();
    let wrapper_name = name_s.clone();
    let wrapped = move || {
        begin_cpu_log_test(&wrapper_name);
        let result = catch_unwind(AssertUnwindSafe(&f));
        end_cpu_log_test(&wrapper_name);
        match result {
            Ok(r) => r,
            Err(_) => Err(FrameworkError::invalid_argument(format!(
                "test panicked: {wrapper_name}"
            ))),
        }
    };

    if let Ok(mut v) = registry().lock() {
        v.push(UnitCase {
            name: name_s,
            run: Box::new(wrapped),
        });
    }
}

pub fn take_unit_tests() -> Vec<UnitCase> {
    if let Ok(mut v) = registry().lock() {
        let mut out = Vec::new();
        std::mem::swap(&mut *v, &mut out);
        return out;
    }
    Vec::new()
}

pub struct Expect<T> {
    actual: T,
}

pub fn expect<T>(actual: T) -> Expect<T> {
    Expect { actual }
}

impl<T> Expect<T>
where
    T: Debug,
{
    pub fn to_be_defined(&self) -> Result<(), FrameworkError> {
        Ok(())
    }
}

impl<T> Expect<T>
where
    T: PartialEq + Debug,
{
    pub fn to_be(&self, expected: T) -> Result<(), FrameworkError> {
        if self.actual != expected {
            return Err(FrameworkError::invalid_argument(format!(
                "expected {:?}, got {:?}",
                expected, self.actual
            )));
        }
        Ok(())
    }
}

impl<T> Expect<Vec<T>>
where
    T: PartialEq + Debug,
{
    pub fn to_contain(&self, needle: T) -> Result<(), FrameworkError> {
        if !self.actual.contains(&needle) {
            return Err(FrameworkError::invalid_argument(format!(
                "array does not contain {:?}",
                needle
            )));
        }
        Ok(())
    }
}

impl Expect<String> {
    pub fn to_contain(&self, needle: &str) -> Result<(), FrameworkError> {
        if !self.actual.contains(needle) {
            return Err(FrameworkError::invalid_argument(format!(
                "'{}' does not contain '{}'",
                self.actual, needle
            )));
        }
        Ok(())
    }
}

impl Expect<&str> {
    pub fn to_contain(&self, needle: &str) -> Result<(), FrameworkError> {
        if !self.actual.contains(needle) {
            return Err(FrameworkError::invalid_argument(format!(
                "'{}' does not contain '{}'",
                self.actual, needle
            )));
        }
        Ok(())
    }
}

impl<T> Expect<T>
where
    T: PartialOrd + Debug,
{
    pub fn to_be_greater_than_or_equal(&self, n: T) -> Result<(), FrameworkError> {
        if self.actual < n {
            return Err(FrameworkError::invalid_argument(format!(
                "expected >= {:?}, got {:?}",
                n, self.actual
            )));
        }
        Ok(())
    }
}

impl<T> Expect<T>
where
    T: Debug + Into<bool> + Copy,
{
    pub fn to_be_truthy(&self) -> Result<(), FrameworkError> {
        if !self.actual.into() {
            return Err(FrameworkError::invalid_argument("expected truthy"));
        }
        Ok(())
    }
}

pub fn assert_throw(
    f: impl FnOnce() -> Result<(), FrameworkError>,
    contains: Option<&str>,
) -> Result<(), FrameworkError> {
    match f() {
        Ok(_) => Err(FrameworkError::invalid_argument("expected throw")),
        Err(e) => {
            if let Some(s) = contains {
                let msg = format!("{e}");
                if !msg.contains(s) {
                    return Err(FrameworkError::invalid_argument(format!(
                        "threw '{msg}', expected to contain '{s}'"
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
    fn expect_to_be_and_contain_work() {
        expect(3_u32).to_be(3).expect("to_be should pass");
        expect(String::from("abcdef"))
            .to_contain("bcd")
            .expect("to_contain should pass");
        expect(vec![1_i32, 2, 3])
            .to_contain(2)
            .expect("vec contain should pass");
    }

    #[test]
    fn registry_take_clears_entries() {
        test("a", || Ok(()));
        let first = take_unit_tests();
        assert_eq!(first.len(), 1);
        let second = take_unit_tests();
        assert!(second.is_empty());
    }
}