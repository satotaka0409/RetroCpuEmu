use std::error::Error;
use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FrameworkError {
    InvalidArgument(String),
    NotImplemented(&'static str),
}

impl FrameworkError {
    pub fn invalid_argument(msg: impl Into<String>) -> Self {
        Self::InvalidArgument(msg.into())
    }

    pub fn not_implemented(feature: &'static str) -> Self {
        Self::NotImplemented(feature)
    }
}

impl Display for FrameworkError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidArgument(msg) => write!(f, "invalid argument: {msg}"),
            Self::NotImplemented(feature) => write!(f, "not implemented: {feature}"),
        }
    }
}

impl Error for FrameworkError {}
