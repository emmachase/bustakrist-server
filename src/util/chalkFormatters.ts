import chalk from "chalk";

export function kst(kst: number) {
    return chalk`{yellowBright ${kst.toLocaleString()}}{yellow KST}`
}

export function kstF2(kst: number) {
    return chalk`{yellowBright ${(kst / 100).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}}{yellow KST}`
}