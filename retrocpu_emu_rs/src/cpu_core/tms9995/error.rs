use core::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Tms9995Error {
	IllegalInstruction { pc: u16, ir: u16 },
	MaxCyclesReached { cycles: usize },
}

impl fmt::Display for Tms9995Error {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		match self {
			Self::IllegalInstruction { pc, ir } => {
				write!(f, "illegal instruction: pc=0x{pc:04X} ir=0x{ir:04X}")
			}
			Self::MaxCyclesReached { cycles } => {
				write!(f, "max cycles reached: {cycles}")
			}
		}
	}
}

impl std::error::Error for Tms9995Error {}
