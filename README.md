# Ficha de Anamnese - Studio Mavi

Protótipo de ficha digital responsiva para micropigmentação e estética, inspirado no formulário visual do Studio Mavi.

## Funcionalidades

- preenchimento em cinco etapas no celular ou computador;
- histórico de saúde, contraindicações, hábitos e avaliação da pele;
- mapa facial desenhável;
- assinatura da cliente e assinatura opcional da profissional;
- geração local de PDF A4 com três páginas, protocolo e assinaturas;
- compartilhamento do PDF pelo menu nativo do aparelho;
- abertura da conversa no WhatsApp `+55 11 99630-2304` como alternativa;
- QR Code para o endereço público da ficha;
- nenhum dado preenchido é armazenado no GitHub.

## Limitação do protótipo

Navegadores não permitem anexar um PDF automaticamente a uma conversa específica do WhatsApp. Em aparelhos compatíveis, o app abre o compartilhamento nativo com o PDF. Nos demais, baixa o arquivo e abre a conversa para que o usuário faça a anexação. Envio totalmente automático requer backend e WhatsApp Business Cloud API.

## Desenvolvimento

```bash
npm install
npm run dev
```

Para gerar a versão estática:

```bash
npm run build
```

O conteúdo de `docs/` corresponde à versão compilada publicada no GitHub Pages.

## Avisos

Este é um protótipo para validação. Antes de uso definitivo, o texto clínico e o consentimento devem ser revisados pela profissional responsável, e a rotina de guarda dos PDFs deve receber controles adequados de acesso e backup.
