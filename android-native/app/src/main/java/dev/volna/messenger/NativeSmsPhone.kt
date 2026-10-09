package dev.volna.messenger

internal fun nativeSmsPhone(country: String, raw: String): String {
    require(country.matches(Regex("\\+[1-9][0-9]{0,2}"))) { "Проверьте код страны" }
    require(raw.length <= 40 && raw.all { it in "+0123456789 ()-" }) { "Проверьте номер телефона" }
    val input = raw.trim()
    val digits = input.filter { it in '0'..'9' }
    val number = when {
        input.startsWith("+") && input.count { it == '+' } == 1 -> "+$digits"
        '+' in input -> throw IllegalArgumentException("Проверьте номер телефона")
        country == "+7" && digits.length == 11 && digits.first() in "78" -> "+7${digits.drop(1)}"
        else -> country + digits
    }
    require(number.matches(Regex("\\+[1-9][0-9]{7,14}"))) { "Укажите полный номер телефона с кодом страны" }
    require(!number.startsWith("+7") || number.length == 12) { "Для +7 укажите 10 цифр номера после кода страны" }
    return number
}
