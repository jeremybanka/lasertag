import css from "./ProfileCard.module.css"

type ProfileCardProps = {
	name: string
	role: string
}

export function ProfileCard({ name, role }: ProfileCardProps) {
	return (
		<profile-card className={css.class}>
			<header>
				<avatar-frame aria-hidden="true">{name.slice(0, 1)}</avatar-frame>
				<user-identity>
					<strong>{name}</strong>
					<span>{role}</span>
				</user-identity>
			</header>
			<footer>
				<small>Available</small>
				<button type="button">Message</button>
			</footer>
		</profile-card>
	)
}
