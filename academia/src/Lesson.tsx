import Link from "next/link";
import React, { useMemo, useRef, useState } from "react";
import { BigCloseSvg, CloseSvg, DoneSvg } from "~/components/Svgs";

type LessonOption = {
  label: string;
  text: string;
  correct: boolean;
  justification: string;
};

type LessonProblem = {
  title: string;
  prompt: string;
  options: LessonOption[];
};

const lessonProblems: LessonProblem[] = [
  {
    title: "Lição 1",
    prompt:
      "Antes da existência do dinheiro, o que já existia nas relações humanas?",
    options: [
      {
        label: "A",
        text: "Um sistema universal de preços comparáveis",
        correct: false,
        justification: "Preço exige unidade de conta comum.",
      },
      {
        label: "B",
        text: "A troca direta de bens e serviços entre indivíduos",
        correct: true,
        justification:
          "Troca emerge sempre que há benefício mútuo percebido; precede moeda e Estado.",
      },
      {
        label: "C",
        text: "Um mercado regulado por autoridade central",
        correct: false,
        justification: "Regulação é camada posterior à troca.",
      },
      {
        label: "D",
        text: "Riqueza abstrata acumulada em crédito formal",
        correct: false,
        justification: "Crédito formal exige abstração e registro institucional.",
      },
    ],
  },
  {
    title: "Lição 2",
    prompt: "Qual é a função original do dinheiro em uma sociedade?",
    options: [
      {
        label: "A",
        text: "Criar valor por circulação financeira",
        correct: false,
        justification: "Circulação redistribui, não cria utilidade.",
      },
      {
        label: "B",
        text: "Determinar o valor real das coisas",
        correct: false,
        justification: "Valor é contextual; dinheiro apenas expressa.",
      },
      {
        label: "C",
        text: "Facilitar e registrar trocas já existentes",
        correct: true,
        justification: "Dinheiro reduz fricção; não cria o fenômeno da troca.",
      },
      {
        label: "D",
        text: "Eliminar a necessidade de confiança",
        correct: false,
        justification: "Risco e confiança continuam existindo.",
      },
    ],
  },
  {
    title: "Lição 3",
    prompt: "O que caracteriza uma troca econômica?",
    options: [
      {
        label: "A",
        text: "Transferência unilateral sem retorno esperado",
        correct: false,
        justification: "Isso é doação.",
      },
      {
        label: "B",
        text: "Apropriação de recursos sem consentimento",
        correct: false,
        justification: "Isso é apropriação.",
      },
      {
        label: "C",
        text: "Renúncia mútua com expectativa de ganho",
        correct: true,
        justification: "Troca exige reciprocidade esperada.",
      },
      {
        label: "D",
        text: "Ação sem possibilidade de escolha",
        correct: false,
        justification: "Sem escolha há coerção, não troca.",
      },
    ],
  },
  {
    title: "Lição 4",
    prompt: "O que define corretamente “preço”?",
    options: [
      {
        label: "A",
        text: "O custo de produção convertido em número",
        correct: false,
        justification: "Custo não define equivalência.",
      },
      {
        label: "B",
        text: "A utilidade intrínseca do bem",
        correct: false,
        justification: "Utilidade é percepção, não métrica.",
      },
      {
        label: "C",
        text: "Uma equivalência expressa em unidade de conta",
        correct: true,
        justification: "Preço é equivalência numericamente expressa.",
      },
      {
        label: "D",
        text: "Uma propriedade natural do objeto",
        correct: false,
        justification: "Preço é convenção, não natureza.",
      },
    ],
  },
  {
    title: "Lição 5",
    prompt: "Qual problema o dinheiro resolve em relação ao escambo?",
    options: [
      {
        label: "A",
        text: "A existência de necessidades humanas",
        correct: false,
        justification: "Necessidades permanecem.",
      },
      {
        label: "B",
        text: "A coincidência de desejos entre as partes",
        correct: true,
        justification:
          "Dinheiro elimina a exigência de desejo simultâneo.",
      },
      {
        label: "C",
        text: "A assimetria de informação em mercados",
        correct: false,
        justification: "Informação imperfeita continua existindo.",
      },
      {
        label: "D",
        text: "O conflito de interesses entre agentes",
        correct: false,
        justification: "Conflito não desaparece com moeda.",
      },
    ],
  },
  {
    title: "Lição 6",
    prompt: "O que é “valor” em uma troca?",
    options: [
      {
        label: "A",
        text: "Uma propriedade fixa do bem",
        correct: false,
        justification: "Valor não é intrínseco.",
      },
      {
        label: "B",
        text: "O preço médio praticado no mercado",
        correct: false,
        justification: "Preço é consequência, não origem.",
      },
      {
        label: "C",
        text: "A utilidade percebida pelo decisor no contexto",
        correct: true,
        justification: "Valor nasce da percepção contextual.",
      },
      {
        label: "D",
        text: "Algo idêntico para todos os compradores",
        correct: false,
        justification: "Preferências tornam valor desigual.",
      },
    ],
  },
  {
    title: "Lição 7",
    prompt: "Qual efeito real o dinheiro tem sobre trocas?",
    options: [
      {
        label: "A",
        text: "Eliminar custos de transação",
        correct: false,
        justification: "Custos caem, não desaparecem.",
      },
      {
        label: "B",
        text: "Tornar decisões puramente racionais",
        correct: false,
        justification: "Psicologia continua mandando.",
      },
      {
        label: "C",
        text: "Aumentar liquidez e comparabilidade",
        correct: true,
        justification: "Dinheiro torna troca mais fluida e comparável.",
      },
      {
        label: "D",
        text: "Substituir trocas não monetárias",
        correct: false,
        justification: "Trocas não monetárias persistem.",
      },
    ],
  },
  {
    title: "Lição 8",
    prompt:
      "Qual afirmação descreve corretamente a relação entre troca, dinheiro e valor?",
    options: [
      {
        label: "A",
        text: "O dinheiro cria valor ao organizar as trocas",
        correct: false,
        justification: "Dinheiro organiza trocas; não cria valor por definição.",
      },
      {
        label: "B",
        text:
          "O valor surge da utilidade percebida, a troca o manifesta, e o dinheiro o expressa",
        correct: true,
        justification:
          "Utilidade percebida → gera valor\nTroca → materializa esse valor entre agentes\nDinheiro → expressa e facilita essa materialização\nOs três ocupam camadas diferentes, sem inverter causalidade.",
      },
      {
        label: "C",
        text: "A troca depende do dinheiro para gerar valor",
        correct: false,
        justification: "Troca antecede dinheiro histórica e logicamente.",
      },
      {
        label: "D",
        text: "O preço define simultaneamente troca e valor",
        correct: false,
        justification: "Preço é expressão numérica; não define valor nem cria troca.",
      },
    ],
  },
];

const formatTime = (timeMs: number): string => {
  const seconds = Math.floor(timeMs / 1000) % 60;
  const minutes = Math.floor(timeMs / 1000 / 60) % 60;
  const hours = Math.floor(timeMs / 1000 / 60 / 60);
  if (hours === 0) {
    return [minutes, seconds]
      .map((value) => value.toString().padStart(2, "0"))
      .join(":");
  }
  return [hours, minutes, seconds]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
};

const Lesson = () => {
  const [problemIndex, setProblemIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [correctAnswerShown, setCorrectAnswerShown] = useState(false);
  const [quitMessageShown, setQuitMessageShown] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [incorrectCount, setIncorrectCount] = useState(0);
  const [lessonComplete, setLessonComplete] = useState(false);

  const startTime = useRef(Date.now());
  const endTime = useRef(startTime.current);

  const problem = lessonProblems[problemIndex];
  const correctIndex = problem.options.findIndex((option) => option.correct);

  const isAnswerCorrect = selectedAnswer === correctIndex;
  const progressCount = Math.min(
    problemIndex + (correctAnswerShown ? 1 : 0),
    lessonProblems.length,
  );
  const progress = useMemo(
    () => progressCount / lessonProblems.length,
    [progressCount],
  );

  const onCheckAnswer = () => {
    if (selectedAnswer === null) return;
    setCorrectAnswerShown(true);
    if (isAnswerCorrect) {
      setCorrectCount((value) => value + 1);
    } else {
      setIncorrectCount((value) => value + 1);
    }
  };

  const onFinish = () => {
    if (problemIndex >= lessonProblems.length - 1) {
      endTime.current = Date.now();
      setLessonComplete(true);
      return;
    }
    setSelectedAnswer(null);
    setCorrectAnswerShown(false);
    setProblemIndex((value) => value + 1);
  };

  const onSkip = () => {
    setSelectedAnswer(null);
    setCorrectAnswerShown(true);
  };

  if (lessonComplete) {
    return (
      <LessonComplete
        correctAnswerCount={correctCount}
        incorrectAnswerCount={incorrectCount}
        startTime={startTime}
        endTime={endTime}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col gap-5 px-4 py-5 sm:px-0 sm:py-0">
      <div className="flex grow flex-col items-center gap-5">
        <div className="w-full max-w-5xl sm:mt-8 sm:px-5">
          <ProgressBar
            progress={progress}
            setQuitMessageShown={setQuitMessageShown}
          />
          <div className="mt-4 text-xs font-bold uppercase tracking-[0.2em] text-gray-400">
            MÓDULO I — Realidade Econômica
          </div>
          <div className="text-sm font-semibold text-gray-500">
            Aula 1 — Dinheiro, valor e troca
          </div>
        </div>

        <section className="flex max-w-2xl grow flex-col gap-5 self-center sm:items-center sm:justify-center sm:gap-12 sm:px-5">
          <div className="self-start text-xs font-bold uppercase tracking-[0.2em] text-gray-400">
            {problem.title}
          </div>
          <h1 className="self-start text-2xl font-bold sm:text-3xl">
            {problem.prompt}
          </h1>
          <div
            className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2"
            role="radiogroup"
          >
            {problem.options.map((option, i) => (
              <div
                key={option.label}
                className={
                  i === selectedAnswer
                    ? "flex cursor-pointer gap-4 rounded-xl border-2 border-b-4 border-blue-300 bg-blue-100 p-4 text-blue-500"
                    : "flex cursor-pointer gap-4 rounded-xl border-2 border-b-4 border-gray-200 p-4 text-gray-600 hover:bg-gray-100"
                }
                role="radio"
                aria-checked={i === selectedAnswer}
                tabIndex={0}
                onClick={() => setSelectedAnswer(i)}
              >
                <div
                  className={
                    i === selectedAnswer
                      ? "flex h-10 w-10 items-center justify-center rounded-full border-2 border-blue-200 bg-white text-sm font-bold"
                      : "flex h-10 w-10 items-center justify-center rounded-full border-2 border-gray-200 bg-white text-sm font-bold text-gray-400"
                  }
                >
                  {option.label}
                </div>
                <h2 className="text-sm font-semibold sm:text-base">
                  {option.text}
                </h2>
              </div>
            ))}
          </div>

          {correctAnswerShown && (
            <div className="w-full rounded-2xl border-2 border-gray-200 bg-white p-4 text-sm text-gray-600">
              <div className="text-xs font-bold uppercase tracking-[0.2em] text-gray-400">
                Justificativas
              </div>
              <div className="mt-3 grid gap-2">
                {problem.options.map((option) => (
                  <div
                    key={option.label}
                    className="flex items-start gap-3"
                  >
                    <span
                      className={
                        option.correct
                          ? "flex h-7 w-7 items-center justify-center rounded-lg bg-lime-100 text-sm font-bold text-green-600"
                          : "flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-sm font-bold text-gray-400"
                      }
                    >
                      {option.label}
                    </span>
                    <span className="text-sm text-gray-600">
                      {option.justification}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      <CheckAnswer
        correctAnswer={
          problem.options[Math.max(0, correctIndex)]?.text ?? ""
        }
        correctAnswerShown={correctAnswerShown}
        isAnswerCorrect={isAnswerCorrect}
        isAnswerSelected={selectedAnswer !== null}
        onCheckAnswer={onCheckAnswer}
        onFinish={onFinish}
        onSkip={onSkip}
      />

      <QuitMessage
        quitMessageShown={quitMessageShown}
        setQuitMessageShown={setQuitMessageShown}
      />
    </div>
  );
};

export default Lesson;

const ProgressBar = ({
  progress,
  setQuitMessageShown,
}: {
  progress: number;
  setQuitMessageShown: (isShown: boolean) => void;
}) => {
  return (
    <header className="flex items-center gap-4">
      {progress === 0 ? (
        <Link href="/" className="text-gray-400">
          <CloseSvg />
          <span className="sr-only">Exit lesson</span>
        </Link>
      ) : (
        <button
          className="text-gray-400"
          onClick={() => setQuitMessageShown(true)}
        >
          <CloseSvg />
          <span className="sr-only">Exit lesson</span>
        </button>
      )}
      <div
        className="h-4 grow rounded-full bg-gray-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={progress}
      >
        <div
          className={
            "h-full rounded-full bg-green-500 transition-all duration-700 " +
            (progress > 0 ? "px-2 pt-1 " : "")
          }
          style={{ width: `${progress * 100}%` }}
        >
          <div className="h-[5px] w-full rounded-full bg-green-400"></div>
        </div>
      </div>
    </header>
  );
};

const QuitMessage = ({
  quitMessageShown,
  setQuitMessageShown,
}: {
  quitMessageShown: boolean;
  setQuitMessageShown: (isShown: boolean) => void;
}) => {
  return (
    <>
      <div
        className={
          quitMessageShown
            ? "fixed bottom-0 left-0 right-0 top-0 z-30 bg-black bg-opacity-60 transition-all duration-300"
            : "pointer-events-none fixed bottom-0 left-0 right-0 top-0 z-30 bg-black bg-opacity-0 transition-all duration-300"
        }
        onClick={() => setQuitMessageShown(false)}
        aria-label="Close quit message"
        role="button"
      ></div>

      <article
        className={
          quitMessageShown
            ? "fixed bottom-0 left-0 right-0 z-40 flex flex-col gap-4 bg-white px-5 py-12 text-center transition-all duration-300 sm:flex-row"
            : "fixed -bottom-96 left-0 right-0 z-40 flex flex-col bg-white px-5 py-12 text-center transition-all duration-300 sm:flex-row"
        }
        aria-hidden={!quitMessageShown}
      >
        <div className="flex grow flex-col gap-4">
          <h2 className="text-lg font-bold sm:text-2xl">
            Tem certeza de que deseja sair?
          </h2>
          <p className="text-gray-500 sm:text-lg">
            Todo o progresso desta lição será perdido.
          </p>
        </div>
        <div className="flex grow flex-col items-center justify-center gap-4 sm:flex-row-reverse">
          <Link
            className="flex w-full items-center justify-center rounded-2xl border-b-4 border-blue-500 bg-blue-400 py-3 font-bold uppercase text-white transition hover:brightness-105 sm:w-48"
            href="/"
          >
            Sair
          </Link>
          <button
            className="w-full rounded-2xl py-3 font-bold uppercase text-blue-400 transition hover:brightness-90 sm:w-48 sm:border-2 sm:border-b-4 sm:border-gray-300 sm:text-gray-400 sm:hover:bg-gray-100"
            onClick={() => setQuitMessageShown(false)}
          >
            Ficar
          </button>
        </div>
      </article>
    </>
  );
};

const CheckAnswer = ({
  isAnswerSelected,
  isAnswerCorrect,
  correctAnswerShown,
  correctAnswer,
  onCheckAnswer,
  onFinish,
  onSkip,
}: {
  isAnswerSelected: boolean;
  isAnswerCorrect: boolean;
  correctAnswerShown: boolean;
  correctAnswer: string;
  onCheckAnswer: () => void;
  onFinish: () => void;
  onSkip: () => void;
}) => {
  return (
    <>
      <section className="border-gray-200 sm:border-t-2 sm:p-10">
        <div className="mx-auto flex max-w-5xl sm:justify-between">
          <button
            className="hidden rounded-2xl border-2 border-b-4 border-gray-200 bg-white p-3 font-bold uppercase text-gray-400 transition hover:border-gray-300 hover:bg-gray-200 sm:block sm:min-w-[150px] sm:max-w-fit"
            onClick={onSkip}
          >
            Pular
          </button>
          {!isAnswerSelected ? (
            <button
              className="grow rounded-2xl bg-gray-200 p-3 font-bold uppercase text-gray-400 sm:min-w-[150px] sm:max-w-fit sm:grow-0"
              disabled
            >
              Verificar
            </button>
          ) : (
            <button
              onClick={onCheckAnswer}
              className="grow rounded-2xl border-b-4 border-green-600 bg-green-500 p-3 font-bold uppercase text-white sm:min-w-[150px] sm:max-w-fit sm:grow-0"
            >
              Verificar
            </button>
          )}
        </div>
      </section>

      <div
        className={
          correctAnswerShown
            ? isAnswerCorrect
              ? "fixed bottom-0 left-0 right-0 bg-lime-100 font-bold text-green-600 transition-all"
              : "fixed bottom-0 left-0 right-0 bg-red-100 font-bold text-red-500 transition-all"
            : "fixed -bottom-52 left-0 right-0"
        }
      >
        <div className="flex max-w-5xl flex-col gap-4 p-5 sm:mx-auto sm:flex-row sm:items-center sm:justify-between sm:p-10 sm:py-14">
          {isAnswerCorrect ? (
            <div className="mb-2 flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="hidden rounded-full bg-white p-5 text-green-500 sm:block">
                <DoneSvg />
              </div>
              <div className="text-2xl">Boa!</div>
            </div>
          ) : (
            <div className="mb-2 flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="hidden rounded-full bg-white p-5 text-red-500 sm:block">
                <BigCloseSvg />
              </div>
              <div className="flex flex-col gap-2">
                <div className="text-2xl">Resposta correta:</div>
                <div className="text-sm font-normal">{correctAnswer}</div>
              </div>
            </div>
          )}
          <button
            onClick={onFinish}
            className={
              isAnswerCorrect
                ? "w-full rounded-2xl border-b-4 border-green-600 bg-green-500 p-3 font-bold uppercase text-white transition hover:brightness-105 sm:min-w-[150px] sm:max-w-fit"
                : "w-full rounded-2xl border-b-4 border-red-600 bg-red-500 p-3 font-bold uppercase text-white transition hover:brightness-105 sm:min-w-[150px] sm:max-w-fit"
            }
          >
            Continuar
          </button>
        </div>
      </div>
    </>
  );
};

const LessonComplete = ({
  correctAnswerCount,
  incorrectAnswerCount,
  startTime,
  endTime,
}: {
  correctAnswerCount: number;
  incorrectAnswerCount: number;
  startTime: React.MutableRefObject<number>;
  endTime: React.MutableRefObject<number>;
}) => {
  return (
    <div className="flex min-h-screen flex-col gap-5 px-4 py-5 sm:px-0 sm:py-0">
      <div className="flex grow flex-col items-center justify-center gap-8 font-bold">
        <h1 className="text-center text-3xl text-yellow-400">
          Aula concluída!
        </h1>
        <div className="flex flex-wrap justify-center gap-5">
          <div className="min-w-[110px] rounded-xl border-2 border-yellow-400 bg-yellow-400">
            <h2 className="py-1 text-center text-white">Acertos</h2>
            <div className="flex justify-center rounded-xl bg-white py-4 text-yellow-400">
              {correctAnswerCount}
            </div>
          </div>
          <div className="min-w-[110px] rounded-xl border-2 border-blue-400 bg-blue-400">
            <h2 className="py-1 text-center text-white">Tempo</h2>
            <div className="flex justify-center rounded-xl bg-white py-4 text-blue-400">
              {formatTime(endTime.current - startTime.current)}
            </div>
          </div>
          <div className="min-w-[110px] rounded-xl border-2 border-green-400 bg-green-400">
            <h2 className="py-1 text-center text-white">Precisão</h2>
            <div className="flex justify-center rounded-xl bg-white py-4 text-green-400">
              {Math.round(
                (correctAnswerCount /
                  Math.max(1, correctAnswerCount + incorrectAnswerCount)) *
                  100,
              )}
              %
            </div>
          </div>
        </div>
      </div>
      <section className="border-gray-200 sm:border-t-2 sm:p-10">
        <div className="mx-auto flex max-w-5xl sm:justify-between">
          <Link
            className="flex w-full items-center justify-center rounded-2xl border-b-4 border-green-600 bg-green-500 p-3 font-bold uppercase text-white transition hover:brightness-105 sm:min-w-[150px] sm:max-w-fit"
            href="/"
          >
            Voltar ao mapa
          </Link>
        </div>
      </section>
    </div>
  );
};
