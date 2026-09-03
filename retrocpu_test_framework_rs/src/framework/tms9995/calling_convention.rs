use std::collections::BTreeSet;

use crate::error::FrameworkError;

use super::types::{
    Tms9995ArgLocation, Tms9995CallDiagnostics, Tms9995CallPlan, Tms9995CallPlanOptions,
    Tms9995StackWord,
};

pub const TMS9995_DEFAULT_ARG_REGISTERS: [u8; 8] = [2, 3, 4, 5, 6, 7, 8, 9];
pub const TMS9995_MONITOR_ARG_REGISTERS: [u8; 8] = TMS9995_DEFAULT_ARG_REGISTERS;
pub const TMS9995_DEFAULT_FORBIDDEN_ARG_REGISTERS: [u8; 8] = [0, 1, 10, 11, 12, 13, 14, 15];
pub const TMS9995_DEFAULT_STACK_INIT: u16 = 0xfe00;
pub const TMS9995_DEFAULT_WORKSPACE: u16 = 0xff00;

fn unique_sorted(values: impl IntoIterator<Item = u8>) -> Vec<u8> {
    let mut set = BTreeSet::new();
    for v in values {
        set.insert(v);
    }
    set.into_iter().collect()
}

pub fn validate_tms9995_arg_registers(
    arg_registers: &[u8],
    forbidden: Option<&[u8]>,
) -> Tms9995CallDiagnostics {
    let forbidden_regs = forbidden.unwrap_or(&TMS9995_DEFAULT_FORBIDDEN_ARG_REGISTERS);
    let forbidden_set: BTreeSet<u8> = forbidden_regs.iter().copied().collect();

    let mut forbidden_hits = Vec::new();
    let mut duplicated_hits = Vec::new();
    let mut seen = BTreeSet::new();

    for &reg in arg_registers {
        if reg > 15 {
            continue;
        }
        if forbidden_set.contains(&reg) {
            forbidden_hits.push(reg);
        }
        if !seen.insert(reg) {
            duplicated_hits.push(reg);
        }
    }

    let out_of_range_hits = arg_registers
        .iter()
        .copied()
        .filter(|r| *r > 15)
        .collect::<Vec<_>>();

    Tms9995CallDiagnostics {
        forbidden_arg_registers: unique_sorted(forbidden_hits),
        duplicated_arg_registers: unique_sorted(duplicated_hits),
        out_of_range_arg_registers: unique_sorted(out_of_range_hits),
    }
}

pub fn plan_tms9995_call(options: &Tms9995CallPlanOptions) -> Result<Tms9995CallPlan, FrameworkError> {
    let arg_registers = options
        .arg_registers
        .clone()
        .unwrap_or_else(|| TMS9995_DEFAULT_ARG_REGISTERS.to_vec());
    let diagnostics = validate_tms9995_arg_registers(&arg_registers, None);

    if !diagnostics.out_of_range_arg_registers.is_empty() {
        return Err(FrameworkError::invalid_argument(format!(
            "argRegisters out of range: {}",
            diagnostics
                .out_of_range_arg_registers
                .iter()
                .map(|x| x.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        )));
    }
    if !diagnostics.duplicated_arg_registers.is_empty() {
        return Err(FrameworkError::invalid_argument(format!(
            "argRegisters duplicated: {}",
            diagnostics
                .duplicated_arg_registers
                .iter()
                .map(|x| x.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        )));
    }
    if !options.allow_special_purpose_registers && !diagnostics.forbidden_arg_registers.is_empty() {
        return Err(FrameworkError::invalid_argument(format!(
            "argRegisters use forbidden registers: {}",
            diagnostics
                .forbidden_arg_registers
                .iter()
                .map(|x| x.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        )));
    }

    let args = options.args.clone();
    let mut registers = [0_u16; 16];
    let sp_before_push = options.stack_init.unwrap_or(TMS9995_DEFAULT_STACK_INIT);
    if (sp_before_push & 1) != 0 {
        return Err(FrameworkError::invalid_argument(format!(
            "stackInit must be even byte address (got 0x{sp_before_push:04x})"
        )));
    }

    let reg_arg_count = arg_registers.len().min(args.len());
    let mut arg_locations = Vec::new();

    for i in 0..reg_arg_count {
        let reg = arg_registers[i] as usize;
        let value = args[i];
        registers[reg] = value;
        arg_locations.push(Tms9995ArgLocation::Register {
            arg_index: i,
            reg: arg_registers[i],
            value,
        });
    }

    let mut sp = sp_before_push;
    let mut stack_words = Vec::new();
    for i in (reg_arg_count..args.len()).rev() {
        sp = sp.wrapping_sub(2);
        let value = args[i];
        stack_words.push(Tms9995StackWord {
            byte_addr: sp,
            value,
            arg_index: i,
        });
        arg_locations.push(Tms9995ArgLocation::Stack {
            arg_index: i,
            byte_addr: sp,
            value,
        });
    }

    registers[10] = sp;
    let return_addr = options.return_addr.unwrap_or(0);
    registers[11] = return_addr;
    // TMS9995 handshake BIOS は R8 を戻りアドレスに使う（R8 が引数に使われないとき）。
    if reg_arg_count <= 6 {
        registers[8] = return_addr;
    }

    arg_locations.sort_by_key(|loc| match loc {
        Tms9995ArgLocation::Register { arg_index, .. } => *arg_index,
        Tms9995ArgLocation::Stack { arg_index, .. } => *arg_index,
    });

    Ok(Tms9995CallPlan {
        registers,
        sp_before_push,
        sp_after_push: sp,
        stack_words,
        arg_locations,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostics_detects_forbidden_and_duplicates() {
        let d = validate_tms9995_arg_registers(&[2, 2, 10, 16], None);
        assert_eq!(d.duplicated_arg_registers, vec![2]);
        assert_eq!(d.forbidden_arg_registers, vec![10]);
        assert_eq!(d.out_of_range_arg_registers, vec![16]);
    }

    #[test]
    fn plan_places_extra_args_to_stack() {
        let opts = Tms9995CallPlanOptions {
            args: vec![0x1111, 0x2222, 0x3333],
            stack_init: Some(0xfe00),
            arg_registers: Some(vec![2, 3]),
            ..Tms9995CallPlanOptions::default()
        };

        let plan = plan_tms9995_call(&opts).expect("plan should succeed");
        assert_eq!(plan.registers[2], 0x1111);
        assert_eq!(plan.registers[3], 0x2222);
        assert_eq!(plan.sp_before_push, 0xfe00);
        assert_eq!(plan.sp_after_push, 0xfdfe);
        assert_eq!(plan.registers[10], 0xfdfe);
        assert_eq!(plan.stack_words.len(), 1);
        assert_eq!(plan.stack_words[0].byte_addr, 0xfdfe);
        assert_eq!(plan.stack_words[0].value, 0x3333);
    }
}
