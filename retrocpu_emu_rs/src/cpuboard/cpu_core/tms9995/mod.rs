//! TMS9995 CPU コア関連の公開 API をまとめるモジュール。

mod bus;
mod core;
mod cru;
mod error;

pub use bus::{Tms9995Bus, Tms9995Ram};
pub use core::{
	StepResult, Tms9995Core, Tms9995State, ST_AGT, ST_C, ST_EQ, ST_IMASK, ST_LGT, ST_OP, ST_OV, ST_X,
};
pub use cru::{Tms9995Cru, Tms9995CruBus};
pub use error::Tms9995Error;
